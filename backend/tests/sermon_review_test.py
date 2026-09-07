"""The review list — place, dismiss, restore, reopen, and the bulk dismiss (spec §8-9).

What happens to everything the scan could not read. The live data these are written against is
~970 rows across four channels, most of them dated livestreams, worked through by one person over
months — so the tests care about the two things that scale badly if they are wrong: **a note
tapped into place must be the note the scan would have made**, and **a bulk action must take
exactly the rows the filter showed and never one with a note behind it**.

Route tests throughout, because every one of these is a decision a person makes through the API.
The one exception is the scan-identical comparison, which has to run the real `Placer` to have
something to compare against.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime

import httpx
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import Book, Chapter, ChapterVerse
from songbird.db.models import (
    SermonNote,
    SermonSource,
    SermonSourceVideo,
    Tag,
    User,
    sermon_note_tags,
)
from songbird.sermons.place import Placer, RunState
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient

_PUBLISHED = datetime(2026, 9, 7, 4, 32, 29, tzinfo=UTC)  # the Monday a Sunday stream goes up
_STREAMED = datetime(2026, 9, 6, 14, 55, 12, tzinfo=UTC)  # the Sunday it actually ran

_BOOKS = [
    Book(id="EXO", name="Exodus", testament="OT", chapter_count=40, canonical_order=2),
    Book(id="PSA", name="Psalms", testament="OT", chapter_count=150, canonical_order=19),
    Book(id="JHN", name="John", testament="NT", chapter_count=21, canonical_order=43),
    Book(id="ACT", name="Acts", testament="NT", chapter_count=28, canonical_order=44),
]


def _answer(reference: str, book: str, chapter: int, start: int, end: int) -> Chapter:
    """What Concord hands back for a reference it recognises: its own spelling, and every verse."""
    return Chapter(
        reference=reference,
        translations=["KJV"],
        verses=[
            ChapterVerse(
                book=book,
                chapter=chapter,
                verse=verse,
                reference=f"{book} {chapter}:{verse}",
                text={"KJV": f"KJV text for {book} {chapter}:{verse}"},
            )
            for verse in range(start, end + 1)
        ],
    )


# Everything else the fake is asked for is a 404 — which is how the real one answers a misspelling.
_KNOWN: dict[str, Chapter | Exception] = {
    "Acts 7:33-35": _answer("Acts 7:33-35", "ACT", 7, 33, 35),
    "Exodus 3:5-10": _answer("Exodus 3:5-10", "EXO", 3, 5, 10),
    "John 3:16": _answer("John 3:16", "JHN", 3, 16, 16),
    # Concord normalizes as it resolves, so a note stores its answer rather than what was typed.
    "Psalm 23": _answer("Psalms 23", "PSA", 23, 1, 6),
}


def _concord(extra: dict[str, Chapter | Exception] | None = None) -> FakeConcordClient:
    return FakeConcordClient(resolved_by_ref={**_KNOWN, **(extra or {})}, books=_BOOKS)


async def _seed_source(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    source_id: int = 1,
    author_id: int = 1,
    tags: tuple[str, ...] = (),
    title: str | None = None,
) -> None:
    async with sessionmaker() as db:
        db.add(
            SermonSource(
                id=source_id,
                kind="channel",
                youtube_id=f"UC{source_id:022d}",
                uploads_playlist_id=f"UU{source_id:022d}",
                input_url="https://www.youtube.com/@achurch",
                title=title or f"Church {source_id}",
                author_id=author_id,
                tags=[Tag(name=name) for name in tags],
            )
        )
        await db.commit()


async def _seed_row(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    video_id: str = "vid00000001",
    source_id: int = 1,
    author_id: int = 1,
    status: str = "needs_passage",
    skip_reason: str | None = None,
    suggestions: tuple[str, ...] = (),
    title: str = "Sunday Worship Service",
    description: str = "Give at example.test",
    published_at: datetime | None = None,
    streamed: bool = False,
    placed_by: str | None = None,
) -> int:
    async with sessionmaker() as db:
        row = SermonSourceVideo(
            source_id=source_id,
            author_id=author_id,
            video_id=video_id,
            title=title,
            description=description,
            published_at=published_at or _PUBLISHED,
            actual_start_time=_STREAMED if streamed else None,
            duration_seconds=3600,
            is_live=streamed,
            status=status,
            skip_reason=skip_reason,
            placed_by=placed_by,
            suggestions=list(suggestions),
            seen_at=_PUBLISHED,
            decided_at=_PUBLISHED,
        )
        db.add(row)
        await db.commit()
        return row.id


async def _row(sessionmaker: async_sessionmaker[AsyncSession], row_id: int) -> SermonSourceVideo:
    async with sessionmaker() as db:
        row = await db.get(SermonSourceVideo, row_id)
        assert row is not None
        return row


async def _notes(sessionmaker: async_sessionmaker[AsyncSession]) -> list[SermonNote]:
    async with sessionmaker() as db:
        return list((await db.execute(select(SermonNote).order_by(SermonNote.id))).scalars())


async def _add_other_user(sessionmaker: async_sessionmaker[AsyncSession]) -> None:
    async with sessionmaker() as db:  # user 1 is seeded by the fixture
        db.add(User(id=2, name="someone-else", created_at=_PUBLISHED))
        await db.commit()


# ---- Placing ------------------------------------------------------------------------------------


async def test_a_tapped_passage_becomes_a_note_and_the_row_says_you_chose_it(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker, tags=("sermon", "grace"))
    row_id = await _seed_row(db_sessionmaker, suggestions=("Acts 7:33-35",), streamed=True)

    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["Acts 7:33-35"]},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "placed"
    assert body["placed_by"] == "manual"
    # Answered with the row in its new shape, notes and all, so the list can redraw one row rather
    # than refetch a list of hundreds after every tap.
    assert [n["reference"] for n in body["notes"]] == ["Acts 7:33-35"]
    assert body["notes"][0]["book_usfm"] == "ACT"
    assert body["notes"][0]["start_chapter"] == 7
    assert body["source_title"] == "Church 1"

    notes = await _notes(db_sessionmaker)
    assert len(notes) == 1
    assert {t.name for t in notes[0].tags} == {"sermon", "grace"}
    # The day the service was STREAMED, not the Monday it was posted (spec §7).
    assert notes[0].event_date == date(2026, 9, 6)


async def test_a_note_you_tap_into_place_is_the_note_the_scan_would_have_made(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The invariant the review list rests on (spec §8).

    A note placed by hand is not a lesser note: it must be identical in every field to one a rule
    made, because it is an ordinary sermon note and a reader in Browse must not be able to tell the
    two apart. `placed_by` on the ROW remembers which happened; nothing on the note does.

    So: one row the scan reads for itself, and an identical row placed through the API with the
    same reference, compared column for column.
    """
    await _seed_source(db_sessionmaker, tags=("sermon",))
    scanned = await _seed_row(
        db_sessionmaker,
        video_id="vid00000001",
        status="pending",
        title="Sunday Service",
        description="Main Scripture: Acts 7:33-35",
        streamed=True,
    )
    tapped = await _seed_row(
        db_sessionmaker,
        video_id="vid00000002",
        title="Sunday Service",
        description="Main Scripture: Acts 7:33-35",
        streamed=True,
    )

    await Placer(db_sessionmaker, _concord()).evaluate_source(1, RunState())  # type: ignore[arg-type]
    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{tapped}/place",
            json={"references": ["Acts 7:33-35"]},
        )
    assert resp.status_code == 200

    notes = {n.source_video_id: n for n in await _notes(db_sessionmaker)}
    by_scan, by_hand = notes[scanned], notes[tapped]
    compared = (
        "reference",
        "book_usfm",
        "book_order_index",
        "start_chapter",
        "start_verse",
        "end_chapter",
        "end_verse",
        "event_date",
        "author_id",
    )
    for field in compared:
        assert getattr(by_hand, field) == getattr(by_scan, field), field
    assert {t.name for t in by_hand.tags} == {t.name for t in by_scan.tags}
    # Both carry the video link, and therefore the id a later check reads to skip them.
    assert by_hand.youtube_video_id == "vid00000002"
    assert by_scan.youtube_video_id == "vid00000001"
    # The rows differ in exactly one field, and it is the one that records who decided.
    assert (await _row(db_sessionmaker, scanned)).placed_by == "scripture_line"
    assert (await _row(db_sessionmaker, tapped)).placed_by == "manual"


async def test_several_passages_make_several_notes(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, suggestions=("Acts 7:33-35", "Exodus 3:5-10"))

    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["Acts 7:33-35", "Exodus 3:5-10", "Psalm 23"]},
        )

    assert resp.status_code == 200
    # Listed in canonical order, not the order they were tapped — the order the rest of songbird
    # lists sermon notes in.
    assert [n["reference"] for n in resp.json()["notes"]] == [
        "Exodus 3:5-10",
        "Psalms 23",
        "Acts 7:33-35",
    ]
    # Concord's spelling, not the tap's: "Psalm 23" was asked for and "Psalms 23" was stored.
    assert {n.reference for n in await _notes(db_sessionmaker)} == {
        "Acts 7:33-35",
        "Exodus 3:5-10",
        "Psalms 23",
    }


async def test_one_bad_reference_places_nothing_and_says_which(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """All-or-nothing (spec §8). Half-placing is the worst outcome available: the row would read
    as done with a passage missing from it, and nothing would ever say so."""
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker)

    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["Acts 7:33-35", "Jhon 3:16"]},
        )

    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"
    assert "Jhon 3:16" in resp.json()["detail"]["message"]
    assert await _notes(db_sessionmaker) == []
    assert (await _row(db_sessionmaker, row_id)).status == "needs_passage"


async def test_concord_being_away_places_nothing(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Invariant 3: Concord's absence is an error, never a guess made locally.
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker)

    async with client_for(FakeConcordClient(error=ConcordUnreachableError("http://concord.test", ConnectionError("down")))) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["Acts 7:33-35"]},
        )

    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
    assert await _notes(db_sessionmaker) == []
    assert (await _row(db_sessionmaker, row_id)).status == "needs_passage"


async def test_a_new_tag_is_created_once_however_many_notes_are_placed(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """`resolve_tags` adds rows without flushing, so asking it twice in one uncommitted session
    for a tag that does not exist yet creates two of it and fails the unique constraint."""
    await _seed_source(db_sessionmaker, tags=("brand-new-tag",))
    row_id = await _seed_row(db_sessionmaker)

    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["Acts 7:33-35", "Exodus 3:5-10", "John 3:16"]},
        )

    assert resp.status_code == 200
    async with db_sessionmaker() as db:
        count = (
            await db.execute(
                select(func.count()).select_from(Tag).where(Tag.name == "brand-new-tag")
            )
        ).scalar_one()
    assert count == 1


async def test_a_skipped_video_can_be_noted_anyway_and_remembers_why_it_was_skipped(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # `skip_reason` is the only record of where the row came from, and restore/reopen read it —
    # so placing must keep it rather than clear it (spec §8).
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, status="skipped", skip_reason="too_short")

    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["John 3:16"]},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "placed"
    assert resp.json()["skip_reason"] == "too_short"


async def test_a_dismissed_video_can_still_be_placed(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, status="dismissed")

    async with client_for(_concord()) as client:
        resp = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["John 3:16"]},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "placed"


async def test_placing_needs_at_least_one_reference_and_not_a_hundred(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker)
    bodies = ({"references": []}, {"references": ["John 3:16"] * 11}, {"references": [""]})

    async with client_for(_concord()) as client:
        for body in bodies:
            resp = await client.post(
                f"/api/v1/sermon-sources/videos/{row_id}/place", json=body
            )
            assert resp.status_code == 422, body
    assert await _notes(db_sessionmaker) == []


# ---- Dismiss, restore, reopen -------------------------------------------------------------------


async def test_not_a_sermon_is_reversible_and_deletes_nothing(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, suggestions=("Acts 7:33-35",))

    async with client_for(_concord()) as client:
        dismissed = await client.post(f"/api/v1/sermon-sources/videos/{row_id}/dismiss")
        restored = await client.post(f"/api/v1/sermon-sources/videos/{row_id}/restore")

    assert dismissed.json()["status"] == "dismissed"
    assert restored.json()["status"] == "needs_passage"
    # The suggestions survive the round trip: they are what the next attempt is chosen from.
    assert restored.json()["suggestions"] == ["Acts 7:33-35"]


async def test_a_restored_skip_goes_back_to_skipped_with_its_reason(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """One rule for undo, shared by restore and reopen. Without it a three-minute announcement
    clip could be promoted into the review queue by dismissing and restoring it."""
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, status="skipped", skip_reason="live_excluded")

    async with client_for(_concord()) as client:
        await client.post(f"/api/v1/sermon-sources/videos/{row_id}/dismiss")
        restored = await client.post(f"/api/v1/sermon-sources/videos/{row_id}/restore")

    assert restored.json()["status"] == "skipped"
    assert restored.json()["skip_reason"] == "live_excluded"


async def test_wrong_passage_takes_back_this_rows_notes_and_only_this_rows(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The fix path for the defect the feature is most likely to produce — a title that reads as a
    reference and isn't. The live audit found one: a date behind a pastor's name resolving to
    sixteen chapters of John."""
    await _seed_source(db_sessionmaker)
    wrong = await _seed_row(db_sessionmaker, video_id="vid00000001")
    other = await _seed_row(db_sessionmaker, video_id="vid00000002")

    async with client_for(_concord()) as client:
        await client.post(
            f"/api/v1/sermon-sources/videos/{wrong}/place",
            json={"references": ["Acts 7:33-35", "Exodus 3:5-10"]},
        )
        await client.post(
            f"/api/v1/sermon-sources/videos/{other}/place", json={"references": ["John 3:16"]}
        )
        resp = await client.post(f"/api/v1/sermon-sources/videos/{wrong}/reopen")

    assert resp.status_code == 200
    assert resp.json()["status"] == "needs_passage"
    assert resp.json()["placed_by"] is None
    assert resp.json()["notes"] == []
    # The other video's note is untouched, which is the whole point of scoping by the ledger row.
    remaining = await _notes(db_sessionmaker)
    assert [n.reference for n in remaining] == ["John 3:16"]
    assert remaining[0].source_video_id == other


async def test_reopening_leaves_no_tag_links_behind_to_collide_with_a_later_note(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Found on the live run, and it broke a catalogue scan.

    SQLite never enforces `ON DELETE CASCADE` — `PRAGMA foreign_keys` is off and songbird never
    turns it on — so a bulk `delete()` of the notes leaves their `sermon_note_tags` rows behind.
    SQLite then reuses the deleted note's id, and the next note handed that id collides on
    (note, tag) and takes the whole check down with it. Counting the notes is not enough to catch
    that; the join table has to be looked at.
    """
    await _seed_source(db_sessionmaker, tags=("sermon", "grace"))
    row_id = await _seed_row(db_sessionmaker)

    async with client_for(_concord()) as client:
        await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["John 3:16", "Acts 7:33-35"]},
        )
        await client.post(f"/api/v1/sermon-sources/videos/{row_id}/reopen")

    async with db_sessionmaker() as db:
        orphans = (
            await db.execute(
                select(func.count())
                .select_from(sermon_note_tags)
                .where(
                    sermon_note_tags.c.sermon_note_id.notin_(select(SermonNote.id)),
                )
            )
        ).scalar_one()
    assert orphans == 0


async def test_reopening_keeps_the_suggestions_to_choose_from_next_time(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(
        db_sessionmaker, suggestions=("Acts 7:33-35", "Exodus 3:5-10", "John 3:16")
    )

    async with client_for(_concord()) as client:
        await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place", json={"references": ["John 3:16"]}
        )
        resp = await client.post(f"/api/v1/sermon-sources/videos/{row_id}/reopen")

    assert resp.json()["suggestions"] == ["Acts 7:33-35", "Exodus 3:5-10", "John 3:16"]


async def test_a_reopened_skip_goes_back_to_skipped(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, status="skipped", skip_reason="too_short")

    async with client_for(_concord()) as client:
        await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place", json={"references": ["John 3:16"]}
        )
        resp = await client.post(f"/api/v1/sermon-sources/videos/{row_id}/reopen")

    assert resp.json()["status"] == "skipped"


async def test_an_action_the_rows_state_does_not_allow_is_a_409(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Not a 404 and not a silent success: the row is real and yours, and it has already moved on
    — usually because another tab is showing a state that stopped being true."""
    await _seed_source(db_sessionmaker)
    rows = {
        "pending": await _seed_row(db_sessionmaker, video_id="vid00000001", status="pending"),
        "placed": await _seed_row(
            db_sessionmaker, video_id="vid00000002", status="placed", placed_by="title"
        ),
        "dismissed": await _seed_row(
            db_sessionmaker, video_id="vid00000003", status="dismissed"
        ),
        "needs_passage": await _seed_row(db_sessionmaker, video_id="vid00000004"),
    }
    # (action, the state it is refused from)
    refused = (
        ("place", "pending"),
        ("place", "placed"),
        ("dismiss", "placed"),
        ("dismiss", "dismissed"),
        ("restore", "needs_passage"),
        ("restore", "placed"),
        ("reopen", "needs_passage"),
        ("reopen", "dismissed"),
    )

    async with client_for(_concord()) as client:
        for action, state in refused:
            body = {"references": ["John 3:16"]} if action == "place" else None
            resp = await client.post(
                f"/api/v1/sermon-sources/videos/{rows[state]}/{action}", json=body
            )
            assert resp.status_code == 409, (action, state)
            assert resp.json()["detail"]["code"] == "VIDEO_STATE", (action, state)
    assert await _notes(db_sessionmaker) == []


# ---- Deleting the last note reopens its video ---------------------------------------------------


async def test_deleting_the_last_note_puts_its_video_back_in_the_list(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Deleting a wrong note from Browse is the other half of "Wrong passage". Without this the
    video would stay marked `placed` with nothing behind it — invisible in the review list, and
    only findable by someone who thought to filter by a state they had no reason to suspect."""
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, suggestions=("Acts 7:33-35",))

    async with client_for(_concord()) as client:
        placed = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place", json={"references": ["John 3:16"]}
        )
        note_id = placed.json()["notes"][0]["id"]
        resp = await client.delete(f"/api/v1/sermon-notes/{note_id}")

    assert resp.status_code == 204
    row = await _row(db_sessionmaker, row_id)
    assert row.status == "needs_passage"
    assert row.placed_by is None
    assert row.suggestions == ["Acts 7:33-35"]


async def test_deleting_one_of_a_videos_notes_leaves_it_placed(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A surviving sibling means the video is still placed, correctly, on its other passage.
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker)

    async with client_for(_concord()) as client:
        placed = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place",
            json={"references": ["John 3:16", "Acts 7:33-35"]},
        )
        await client.delete(f"/api/v1/sermon-notes/{placed.json()['notes'][0]['id']}")

    assert (await _row(db_sessionmaker, row_id)).status == "placed"


async def test_deleting_a_note_nobody_placed_changes_no_ledger_row(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A hand-written note carries no link to a ledger row, and deleting it must not go looking.
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker, status="placed", placed_by="title")
    async with client_for(_concord()) as client:
        made = await client.post(
            "/api/v1/sermon-notes",
            json={
                "title": "By hand",
                "sermon_url": "https://example.test/s",
                "reference": "John 3:16",
                "tags": [],
            },
        )
        resp = await client.delete(f"/api/v1/sermon-notes/{made.json()['id']}")

    assert resp.status_code == 204
    assert (await _row(db_sessionmaker, row_id)).status == "placed"


async def test_a_row_already_reopened_is_not_reopened_again_by_a_late_delete(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Deleting a note must not overrule a decision made after it. Dismiss the row after placing
    it — by deleting the note, the row must stay dismissed rather than jump back into the list."""
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker)

    async with client_for(_concord()) as client:
        placed = await client.post(
            f"/api/v1/sermon-sources/videos/{row_id}/place", json={"references": ["John 3:16"]}
        )
        await client.post(f"/api/v1/sermon-sources/videos/{row_id}/reopen")
        await client.post(f"/api/v1/sermon-sources/videos/{row_id}/dismiss")
        # The note is already gone with the reopen, so make a fresh one pointing at the row.
        assert placed.status_code == 200

    async with db_sessionmaker() as db:
        db.add(
            SermonNote(
                title="stray",
                sermon_url="https://www.youtube.com/watch?v=vid00000001",
                reference="John 3:16",
                book_usfm="JHN",
                book_order_index=43,
                start_chapter=3,
                start_verse=16,
                end_chapter=3,
                end_verse=16,
                author_id=1,
                source_video_id=row_id,
            )
        )
        await db.commit()
        stray = (await db.execute(select(SermonNote.id))).scalars().all()[-1]

    async with client_for(_concord()) as client:
        await client.delete(f"/api/v1/sermon-notes/{stray}")

    assert (await _row(db_sessionmaker, row_id)).status == "dismissed"


# ---- The bulk dismiss ---------------------------------------------------------------------------


async def test_a_filter_and_one_confirm_clears_a_stretch_of_dated_livestreams(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The case the real data demands: one church left ~350 dated livestreams in the review list
    in a single scan, and "everything from this channel before 2025" has to be one action."""
    await _seed_source(db_sessionmaker)
    old = [
        await _seed_row(
            db_sessionmaker,
            video_id=f"vid0000000{n}",
            published_at=datetime(2024, 6, n, 12, 0, tzinfo=UTC),
        )
        for n in (1, 2, 3)
    ]
    recent = await _seed_row(
        db_sessionmaker,
        video_id="vid00000009",
        published_at=datetime(2025, 6, 1, 12, 0, tzinfo=UTC),
    )

    async with client_for(_concord()) as client:
        resp = await client.post(
            "/api/v1/sermon-sources/videos/dismiss-matching",
            json={"source_id": 1, "published_before": "2024-12-31"},
        )

    assert resp.status_code == 200
    assert resp.json() == {"dismissed": 3}
    for row_id in old:
        assert (await _row(db_sessionmaker, row_id)).status == "dismissed"
    assert (await _row(db_sessionmaker, recent)).status == "needs_passage"


async def test_the_bulk_dismiss_never_touches_a_video_with_notes_behind_it(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """However wide the filter, this can never delete a note — which is why the count it returns
    can be smaller than the number of rows on screen."""
    await _seed_source(db_sessionmaker)
    waiting = await _seed_row(db_sessionmaker, video_id="vid00000001")
    already = await _seed_row(db_sessionmaker, video_id="vid00000002")
    pending = await _seed_row(db_sessionmaker, video_id="vid00000003", status="pending")

    async with client_for(_concord()) as client:
        await client.post(
            f"/api/v1/sermon-sources/videos/{already}/place", json={"references": ["John 3:16"]}
        )
        resp = await client.post(
            "/api/v1/sermon-sources/videos/dismiss-matching", json={"source_id": 1}
        )

    assert resp.json() == {"dismissed": 1}
    assert (await _row(db_sessionmaker, waiting)).status == "dismissed"
    assert (await _row(db_sessionmaker, already)).status == "placed"
    # Untouched too: a pending row has not been read yet, and dismissing it would throw away the
    # work the next check is about to do.
    assert (await _row(db_sessionmaker, pending)).status == "pending"
    assert len(await _notes(db_sessionmaker)) == 1


async def test_the_bulk_dismiss_refuses_to_mean_everything(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Unrecoverable in one action — restore is per row — and never something somebody meant.
    await _seed_source(db_sessionmaker)
    row_id = await _seed_row(db_sessionmaker)
    empty = ({}, {"q": "   "}, {"source_id": None, "status": None, "q": ""})

    async with client_for(_concord()) as client:
        for body in empty:
            resp = await client.post(
                "/api/v1/sermon-sources/videos/dismiss-matching", json=body
            )
            assert resp.status_code == 422, body
            assert resp.json()["detail"]["code"] == "EMPTY_FILTER", body
    assert (await _row(db_sessionmaker, row_id)).status == "needs_passage"


async def test_the_bulk_dismiss_takes_the_same_rows_the_list_showed(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The reason both go through one filter builder. Every filter in turn: what the listing said
    it would show is what the sweep takes."""
    await _seed_source(db_sessionmaker, source_id=1, title="Majestic View")
    await _seed_source(db_sessionmaker, source_id=2, title="Cornerstone")
    await _seed_row(
        db_sessionmaker,
        video_id="vid00000001",
        title="Sunday Worship Service",
        published_at=datetime(2024, 3, 1, 12, 0, tzinfo=UTC),
    )
    await _seed_row(
        db_sessionmaker,
        video_id="vid00000002",
        title="Christmas Concert",
        status="skipped",
        skip_reason="too_short",
        published_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )
    await _seed_row(db_sessionmaker, video_id="vid00000003", source_id=2, title="A Study")

    filters: tuple[dict[str, object], ...] = (
        {"source_id": 1},
        {"status": "skipped"},
        {"published_before": "2024-12-31"},
        {"published_after": "2025-01-01"},
        {"q": "concert"},
    )
    async with client_for(_concord()) as client:
        for body in filters:
            listed = await client.get(
                "/api/v1/sermon-sources/videos",
                params={k: str(v) for k, v in body.items()},
            )
            swept = await client.post(
                "/api/v1/sermon-sources/videos/dismiss-matching", json=body
            )
            assert swept.json()["dismissed"] == listed.json()["total"], body
            # Put them back for the next filter in the table.
            for video in listed.json()["videos"]:
                await client.post(f"/api/v1/sermon-sources/videos/{video['id']}/restore")


# ---- The listing's new filters ------------------------------------------------------------------


async def test_the_date_filter_uses_the_day_the_row_shows(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A service streamed 14:55 on the Sunday and posted 04:32 on the Monday shows as Sunday, and
    a filter that disagreed with the screen would make the bulk dismiss take rows nobody saw."""
    await _seed_source(db_sessionmaker)
    streamed = await _seed_row(db_sessionmaker, video_id="vid00000001", streamed=True)
    posted = await _seed_row(db_sessionmaker, video_id="vid00000002", streamed=False)

    async with client_for(_concord()) as client:
        resp = await client.get(
            "/api/v1/sermon-sources/videos", params={"published_before": "2026-09-06"}
        )

    assert [v["id"] for v in resp.json()["videos"]] == [streamed]
    assert posted not in [v["id"] for v in resp.json()["videos"]]


async def test_both_ends_of_a_date_range_include_the_day_you_named(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # "Before 7 September" said out loud includes the 7th; a calendar picker means the day picked.
    await _seed_source(db_sessionmaker)
    # The last second of the 7th and the first of the 6th: both ends of the range, exactly.
    late = await _seed_row(
        db_sessionmaker,
        video_id="vid00000001",
        published_at=datetime(2026, 9, 7, 23, 59, 59, tzinfo=UTC),
    )
    early = await _seed_row(
        db_sessionmaker,
        video_id="vid00000002",
        published_at=datetime(2026, 9, 6, 0, 0, 0, tzinfo=UTC),
    )

    async with client_for(_concord()) as client:
        both = await client.get(
            "/api/v1/sermon-sources/videos",
            params={"published_after": "2026-09-06", "published_before": "2026-09-07"},
        )
        only_late = await client.get(
            "/api/v1/sermon-sources/videos", params={"published_after": "2026-09-07"}
        )

    assert {v["id"] for v in both.json()["videos"]} == {late, early}
    assert [v["id"] for v in only_late.json()["videos"]] == [late]


async def test_searching_a_title_ignores_case_and_treats_a_wildcard_as_text(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The search feeds a bulk write, so it must never quietly widen: a title search for "100%"
    is a search for a percent sign, not a wildcard that matches the whole catalogue."""
    await _seed_source(db_sessionmaker)
    await _seed_row(db_sessionmaker, video_id="vid00000001", title="Christmas CONCERT")
    await _seed_row(db_sessionmaker, video_id="vid00000002", title="Giving 100% on Sunday")
    # The row that tells an escaped percent sign from a wildcard: "100%" unescaped is LIKE
    # '%100%%', which reaches this title too. Without it the escaping could be deleted and every
    # test would still pass.
    await _seed_row(db_sessionmaker, video_id="vid00000003", title="Sunday 1000 Reasons")
    await _seed_row(db_sessionmaker, video_id="vid00000004", title="An ordinary sermon")

    async with client_for(_concord()) as client:
        cased = await client.get("/api/v1/sermon-sources/videos", params={"q": "concert"})
        wild = await client.get("/api/v1/sermon-sources/videos", params={"q": "100%"})

    assert [v["title"] for v in cased.json()["videos"]] == ["Christmas CONCERT"]
    assert [v["title"] for v in wild.json()["videos"]] == ["Giving 100% on Sunday"]


async def test_the_state_counts_ignore_the_state_you_chose_but_nothing_else(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Choosing a state must not hide the number that told you to choose it — but a source or a
    date range must still narrow them, or "Dismiss all N matching" would promise the wrong N."""
    await _seed_source(db_sessionmaker, source_id=1)
    await _seed_source(db_sessionmaker, source_id=2)
    await _seed_row(db_sessionmaker, video_id="vid00000001", source_id=1)
    await _seed_row(db_sessionmaker, video_id="vid00000002", source_id=1, status="dismissed")
    await _seed_row(
        db_sessionmaker,
        video_id="vid00000003",
        source_id=1,
        status="skipped",
        skip_reason="too_short",
    )
    await _seed_row(db_sessionmaker, video_id="vid00000004", source_id=2)

    async with client_for(_concord()) as client:
        resp = await client.get(
            "/api/v1/sermon-sources/videos", params={"source_id": 1, "status": "needs_passage"}
        )

    body = resp.json()
    assert body["total"] == 1  # the filter as asked
    assert body["counts"]["needs_passage"] == 1
    assert body["counts"]["dismissed"] == 1
    assert body["counts"]["skipped"] == 1
    # Source 2's row is not in the tally: the source filter still applies.
    assert sum(body["counts"].values()) == 3


# ---- Scoping ------------------------------------------------------------------------------------


async def test_another_users_video_is_a_404_on_every_action(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A 404 rather than a 403: another user's video must not even be known to exist.
    await _add_other_user(db_sessionmaker)
    await _seed_source(db_sessionmaker, source_id=1, author_id=2)
    theirs = await _seed_row(db_sessionmaker, author_id=2, status="placed", placed_by="title")

    async with client_for(_concord()) as client:
        for action in ("place", "dismiss", "restore", "reopen"):
            body = {"references": ["John 3:16"]} if action == "place" else None
            resp = await client.post(
                f"/api/v1/sermon-sources/videos/{theirs}/{action}", json=body
            )
            assert resp.status_code == 404, action
            assert resp.json()["detail"]["code"] == "VIDEO_NOT_FOUND", action
    # And it is still exactly as it was.
    assert (await _row(db_sessionmaker, theirs)).status == "placed"


async def test_a_bulk_dismiss_cannot_reach_another_users_videos(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _add_other_user(db_sessionmaker)
    await _seed_source(db_sessionmaker, source_id=1, author_id=2)
    await _seed_source(db_sessionmaker, source_id=2, author_id=1)
    theirs = await _seed_row(db_sessionmaker, video_id="vid00000001", author_id=2)
    mine = await _seed_row(db_sessionmaker, video_id="vid00000002", source_id=2)

    async with client_for(_concord()) as client:
        # Their source id is a 404, not an empty sweep.
        by_source = await client.post(
            "/api/v1/sermon-sources/videos/dismiss-matching", json={"source_id": 1}
        )
        # And a filter that names no source still only reaches my own rows.
        by_status = await client.post(
            "/api/v1/sermon-sources/videos/dismiss-matching", json={"status": "needs_passage"}
        )

    assert by_source.status_code == 404
    assert by_status.json() == {"dismissed": 1}
    assert (await _row(db_sessionmaker, theirs)).status == "needs_passage"
    assert (await _row(db_sessionmaker, mine)).status == "dismissed"


async def test_dismiss_matching_is_not_read_as_a_video_id(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The trap `/status` and `/videos` already document: FastAPI matches the path pattern before
    # converting the int, so a route declared the other way round would 422 on int("dismiss-…").
    async with client_for(_concord()) as client:
        resp = await client.post(
            "/api/v1/sermon-sources/videos/dismiss-matching", json={"status": "needs_passage"}
        )

    assert resp.status_code == 200
    assert resp.json() == {"dismissed": 0}
