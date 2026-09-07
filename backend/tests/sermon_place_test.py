"""Reading the passage out of a sermon and creating the note (v1.7 sermon sources, spec §7).

The riskiest logic in the feature, so these tests are mostly about what does NOT happen: a giving
verse deeper in a description does not become a note, a channel's template verse does not become a
note, junk that reaches Concord does not become a note, and a video whose passage was never written
down waits in the review list rather than being guessed at.

Most of them drive the `Placer` directly over seeded ledger rows, which is the payoff of splitting
the check in two: reading a passage needs no YouTube at all. The few that go through `ScanRunner`
are the ones about what a whole run does when Concord goes away.

Fixtures are one-line shapes taken from the four real channels — the labelled line, the opening
line, the parenthesised title — not whole descriptions.
"""

from collections.abc import Callable
from datetime import UTC, datetime

import httpx
import pytest
from songbird.api._tags import resolve_tags
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import Book, Chapter, ChapterVerse
from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo, Tag, User
from songbird.sermons.place import STATUS_CONCORD_DOWN, Placer, RunState
from songbird.sermons.scan import STATUS_OK, STATUS_UNKNOWN, ScanRunner
from songbird.youtube.schemas import Video
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient, FakeYouTubeClient
from tests.helpers import build_chapter

_UPLOADS = "UUa1b2c3d4e5f6g7h8i9j0k1"
_CHANNEL_ID = "UCa1b2c3d4e5f6g7h8i9j0k1"
_PUBLISHED = datetime(2026, 9, 7, 4, 32, 29, tzinfo=UTC)  # the Monday a Sunday stream goes up
_STREAMED = datetime(2026, 9, 6, 14, 55, 12, tzinfo=UTC)  # the Sunday it actually ran

_BOOKS = [
    Book(id="GEN", name="Genesis", testament="OT", chapter_count=50, canonical_order=1),
    Book(id="EXO", name="Exodus", testament="OT", chapter_count=40, canonical_order=2),
    Book(id="2CH", name="2 Chronicles", testament="OT", chapter_count=36, canonical_order=14),
    Book(id="PSA", name="Psalms", testament="OT", chapter_count=150, canonical_order=19),
    Book(id="MAT", name="Matthew", testament="NT", chapter_count=28, canonical_order=40),
    Book(id="JHN", name="John", testament="NT", chapter_count=21, canonical_order=43),
    Book(id="ACT", name="Acts", testament="NT", chapter_count=28, canonical_order=44),
    Book(id="1PE", name="1 Peter", testament="NT", chapter_count=5, canonical_order=60),
]


def _answer(reference: str, book: str, verses: list[tuple[int, int]]) -> Chapter:
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
            for chapter, verse in verses
        ],
    )


def _run(chapter: int, start: int, end: int) -> list[tuple[int, int]]:
    return [(chapter, verse) for verse in range(start, end + 1)]


# What our fake Concord knows. Everything else it is asked for is a 404 — which is exactly how the
# real one behaves for `Episode 63`, `Sunday 9:00` and `Israel 24:03` (checked live).
_KNOWN: dict[str, Chapter | Exception] = {
    "Acts 7:33-35": _answer("Acts 7:33-35", "ACT", _run(7, 33, 35)),
    "Exodus 3:5-10": _answer("Exodus 3:5-10", "EXO", _run(3, 5, 10)),
    "2 Chronicles 29": _answer("2 Chronicles 29", "2CH", _run(29, 1, 36)),
    "1 Peter 1:6-7": _answer("1 Peter 1:6-7", "1PE", _run(1, 6, 7)),
    "Matthew 28:19": _answer("Matthew 28:19", "MAT", _run(28, 19, 19)),
    "John 3:16": _answer("John 3:16", "JHN", _run(3, 16, 16)),
    "Genesis 1:1": _answer("Genesis 1:1", "GEN", _run(1, 1, 1)),
    "Psalm 23": _answer("Psalms 23", "PSA", _run(23, 1, 6)),
    # Concord normalizes an abbreviation as it resolves, which is why a note stores its answer
    # rather than the string the church typed.
    "2 Chron 29": _answer("2 Chronicles 29", "2CH", _run(29, 1, 36)),
}


def _concord(extra: dict[str, Chapter | Exception] | None = None) -> FakeConcordClient:
    return FakeConcordClient(resolved_by_ref={**_KNOWN, **(extra or {})}, books=_BOOKS)


async def _seed(
    sessionmaker: async_sessionmaker[AsyncSession],
    videos: list[tuple[str, str, str]],
    *,
    tags: list[str] | None = None,
    author_id: int = 1,
    source_id: int = 1,
    streamed: bool = False,
) -> None:
    """A source and its ledger, as `(video_id, title, description)` triples already `pending`."""
    async with sessionmaker() as db:
        db.add(
            SermonSource(
                id=source_id,
                kind="channel",
                # Distinct per source: one author may not register the same channel twice.
                youtube_id=f"{_CHANNEL_ID[:-1]}{source_id}",
                uploads_playlist_id=_UPLOADS,
                input_url="https://www.youtube.com/@achurch",
                title="A Church",
                author_id=author_id,
                # Through the real get-or-create, not `Tag(name=…)`: two sources sharing a tag
                # must share the row, exactly as adding them through the API would.
                tags=await resolve_tags(db, tags or []),
            )
        )
        for video_id, title, description in videos:
            db.add(
                SermonSourceVideo(
                    source_id=source_id,
                    author_id=author_id,
                    video_id=video_id,
                    title=title,
                    description=description,
                    published_at=_PUBLISHED,
                    actual_start_time=_STREAMED if streamed else None,
                    duration_seconds=3600,
                    is_live=streamed,
                    status="pending",
                    seen_at=_PUBLISHED,
                )
            )
        await db.commit()


async def _rows(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> dict[str, SermonSourceVideo]:
    async with sessionmaker() as db:
        result = await db.execute(select(SermonSourceVideo).order_by(SermonSourceVideo.id))
        return {row.video_id: row for row in result.scalars()}


async def _notes(sessionmaker: async_sessionmaker[AsyncSession]) -> list[SermonNote]:
    async with sessionmaker() as db:
        result = await db.execute(select(SermonNote).order_by(SermonNote.id))
        return list(result.scalars())


async def _place(
    sessionmaker: async_sessionmaker[AsyncSession],
    concord: FakeConcordClient | None = None,
    *,
    source_id: int = 1,
) -> RunState:
    state = RunState()
    placer = Placer(sessionmaker, concord or _concord())  # type: ignore[arg-type]
    await placer.evaluate_source(source_id, state)
    return state


# ---- The rules, spec §7, first hit wins -------------------------------------------------------


async def test_a_labelled_line_places_every_reference_on_it(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Celebration Church's shape. Two passages on the line become two notes, and the en-dashes the
    # church typed are normalized before Concord ever sees them.
    await _seed(
        db_sessionmaker,
        [
            (
                "vid00000001",
                "Holy Ground",
                "Main Scripture: Acts 7:33–35 (with reference to Exodus 3:5–10)",
            )
        ],
    )

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("placed", "scripture_line")
    notes = await _notes(db_sessionmaker)
    assert [(n.reference, n.book_usfm) for n in notes] == [
        ("Acts 7:33-35", "ACT"),
        ("Exodus 3:5-10", "EXO"),
    ]


async def test_a_title_places_when_the_description_says_nothing(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # 2819 Church's shape: the passage is in the title, in parentheses.
    await _seed(
        db_sessionmaker,
        [("vid00000001", "The Faithfulness of God (1 Peter 1:6-7)", "Join us Sunday at 9:00")],
    )

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("placed", "title")
    assert [n.reference for n in await _notes(db_sessionmaker)] == ["1 Peter 1:6-7"]


async def test_the_opening_line_places_and_the_rest_of_the_body_does_not(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Cornerstone's shape, and the sharpest thing in §7.

    The passage is in the description's first line. A giving verse sits further down — and it must
    become NOTHING, because the rules stop at the first hit. If they gathered everything they could
    find, every sermon on this channel would carry a note on the giving verse as well.
    """
    await _seed(
        db_sessionmaker,
        [
            (
                "vid00000001",
                "Sunday Service",
                "7/22/2026 An in-depth study of 2 Chronicles 29.\n\nGive online — John 3:16",
            )
        ],
    )

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("placed", "first_line")
    notes = await _notes(db_sessionmaker)
    assert [n.reference for n in notes] == ["2 Chronicles 29"]
    # Chapter-only, so the note spans the whole chapter — the existing resolve behaviour.
    assert (notes[0].start_chapter, notes[0].start_verse) == (29, 1)
    assert (notes[0].end_chapter, notes[0].end_verse) == (29, 36)


async def test_a_heading_places_the_references_written_beneath_it(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(
        db_sessionmaker,
        [
            (
                "vid00000001",
                "Sunday Service",
                "Scripture References:\nGenesis 1:1\nJohn 3:16\n\nGive online",
            )
        ],
    )

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("placed", "scripture_line")
    assert [n.reference for n in await _notes(db_sessionmaker)] == ["Genesis 1:1", "John 3:16"]


async def test_a_labelled_line_concord_rejects_falls_through_to_the_title(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A "hit" is a reference Concord RECOGNISES, not merely one the finder shaped. Otherwise a
    # labelled line saying "Scripture: Episode 63" would stop the rules dead and place nothing.
    await _seed(
        db_sessionmaker,
        [("vid00000001", "Born Again (John 3:16)", "Scripture: Episode 63")],
    )

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("placed", "title")
    assert [n.reference for n in await _notes(db_sessionmaker)] == ["John 3:16"]


async def test_a_note_stores_concords_spelling_not_the_churchs(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # So notes collected from four churches read alike however each of them abbreviates.
    await _seed(db_sessionmaker, [("vid00000001", "A study", "Scripture: 2 Chron. 29")])

    await _place(db_sessionmaker)

    assert [n.reference for n in await _notes(db_sessionmaker)] == ["2 Chronicles 29"]


async def test_two_spellings_of_one_passage_make_one_note(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Deduplicated by ANCHOR, not by string: both resolve to the same span, so it is one sermon
    # note and not two identical ones.
    await _seed(
        db_sessionmaker,
        [("vid00000001", "A study", "Scripture: 2 Chron. 29 and 2 Chronicles 29")],
    )

    await _place(db_sessionmaker)

    assert [n.reference for n in await _notes(db_sessionmaker)] == ["2 Chronicles 29"]


# ---- When nothing states the passage ----------------------------------------------------------


async def test_nothing_anywhere_waits_in_the_review_list_with_its_suggestions(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Majestic View's shape: a dated livestream with no passage stated anywhere. The references
    # that ARE in the description become suggestions, in the order they appear — one tap each,
    # never a guess.
    await _seed(
        db_sessionmaker,
        [
            (
                "vid00000001",
                "Sunday Service Sep. 06 2026",
                "Welcome!\n\nGive online — Psalm 23\nOur vision — John 3:16",
            )
        ],
    )

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("needs_passage", None)
    # Concord's spelling again, so slice 5's one-tap place re-resolves what the reader saw.
    assert row.suggestions == ["Psalms 23", "John 3:16"]
    assert row.decided_at is not None
    assert await _notes(db_sessionmaker) == []


async def test_junk_reaches_concord_and_leaves_no_trace(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The finder is loose on purpose and offers all three of these. Concord is what decides they
    # are not references, and nothing about them survives that.
    concord = _concord()
    await _seed(
        db_sessionmaker,
        [("vid00000001", "Episode 63", "Sunday 9:00 — a service in Israel 24:03")],
    )

    await _place(db_sessionmaker, concord)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert row.status == "needs_passage"
    assert row.suggestions == []
    assert await _notes(db_sessionmaker) == []
    # They really were offered to Concord — this is the division of labour, not a regex opinion.
    assert {"Episode 63", "Sunday 9:00", "Israel 24:03"} <= set(concord.resolve_calls)


async def test_a_reference_is_asked_about_once_per_run(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A church repeats itself; the run's cache is what stops that costing a lookup every time.
    concord = _concord()
    await _seed(
        db_sessionmaker,
        [
            ("vid00000001", "Part one", "Scripture: John 3:16"),
            ("vid00000002", "Part two", "Scripture: John 3:16"),
            ("vid00000003", "Part three", "Scripture: John 3:16"),
        ],
    )

    await _place(db_sessionmaker, concord)

    assert concord.resolve_calls.count("John 3:16") == 1
    assert len(await _notes(db_sessionmaker)) == 3


# ---- Boilerplate: the channel's template, not a sermon's passage -------------------------------


def _templated(count: int, *, reference: str) -> list[tuple[str, str, str]]:
    """A channel whose every description opens with the same reference.

    On the FIRST line, where rule 3 would place it — so what these tests measure is the
    boilerplate rule doing the blocking, not a reference that no rule was looking at anyway.
    """
    return [
        (f"vid{i:08d}", f"Sermon {i}", f"{reference} — our mission this year\n\nGive online")
        for i in range(count)
    ]


async def test_a_reference_in_half_a_channels_videos_is_never_placed(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # 2819 Church is named after Matthew 28:19 and puts it in every description. Placing a note on
    # it every week would be a wrong anchor every week.
    videos = _templated(6, reference="Matthew 28:19") + [
        ("vid00000006", "Plain", "Welcome!"),
        ("vid00000007", "Also plain", "Welcome!"),
    ]
    await _seed(db_sessionmaker, videos)

    await _place(db_sessionmaker)

    assert await _notes(db_sessionmaker) == []
    rows = await _rows(db_sessionmaker)
    assert {row.status for row in rows.values()} == {"needs_passage"}
    # Struck out of the suggestions too, not merely out of the rules.
    assert all(row.suggestions == [] for row in rows.values())


async def test_a_channel_too_small_to_judge_keeps_its_references(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Four videos: half is two, and a two-part series on one passage would have its own passage
    # struck out as the channel's template. Under five there is no frequency to measure.
    await _seed(db_sessionmaker, _templated(4, reference="Matthew 28:19"))

    await _place(db_sessionmaker)

    notes = await _notes(db_sessionmaker)
    assert [n.reference for n in notes] == ["Matthew 28:19"] * 4
    assert {row.placed_by for row in (await _rows(db_sessionmaker)).values()} == {"first_line"}


async def test_boilerplate_is_counted_over_the_whole_ledger_not_just_what_is_pending(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A bigger denominator makes a template easier to see.

    Five of these six were skipped for length long ago and are not being read now — but their
    descriptions still carry the church's template, and that is exactly what says the reference in
    the one remaining video belongs to the channel rather than to the sermon.
    """
    await _seed(db_sessionmaker, _templated(6, reference="Matthew 28:19"))
    async with db_sessionmaker() as db:
        result = await db.execute(select(SermonSourceVideo).order_by(SermonSourceVideo.id))
        for row in list(result.scalars())[:5]:
            row.status = "skipped"
            row.skip_reason = "too_short"
        await db.commit()

    await _place(db_sessionmaker)

    assert await _notes(db_sessionmaker) == []


# ---- What a note ends up being ----------------------------------------------------------------


async def test_a_streamed_service_is_dated_the_day_it_streamed(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The Sunday it ran, not the Monday it went up — what the church's own page says.
    await _seed(
        db_sessionmaker,
        [("vid00000001", "A study", "Scripture: John 3:16")],
        streamed=True,
    )

    await _place(db_sessionmaker)

    assert [n.event_date for n in await _notes(db_sessionmaker)] == [_STREAMED.date()]


async def test_an_ordinary_upload_is_dated_the_day_it_was_published(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(db_sessionmaker, [("vid00000001", "A study", "Scripture: John 3:16")])

    await _place(db_sessionmaker)

    assert [n.event_date for n in await _notes(db_sessionmaker)] == [_PUBLISHED.date()]


async def test_every_note_from_one_video_shares_its_title_link_date_and_tags(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(
        db_sessionmaker,
        [("vid00000001", "Holy Ground", "Scripture: Acts 7:33-35 and Exodus 3:5-10")],
        tags=["sermon", "cornerstone"],
    )

    await _place(db_sessionmaker)

    notes = await _notes(db_sessionmaker)
    assert len(notes) == 2
    assert {n.title for n in notes} == {"Holy Ground"}
    assert {n.sermon_url for n in notes} == {"https://www.youtube.com/watch?v=vid00000001"}
    assert {n.event_date for n in notes} == {_PUBLISHED.date()}
    assert {tuple(sorted(t.name for t in n.tags)) for n in notes} == {("cornerstone", "sermon")}
    # The link back to the row that made them — the actual row, not merely "all the same".
    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert {n.source_video_id for n in notes} == {row.id}
    # And the id the model derives from the URL, which is what makes a later check skip this video.
    assert {n.youtube_video_id for n in notes} == {"vid00000001"}
    # Canonical order comes from Concord, never from songbird.
    assert sorted(n.book_order_index for n in notes) == [2, 44]


async def test_a_tag_shared_by_two_sources_is_one_row(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # `resolve_tags` adds rows without flushing, so resolving per note would make a second row for
    # the same new name and fail the unique constraint at flush.
    await _seed(db_sessionmaker, [("vid00000001", "One", "Scripture: John 3:16")], tags=["sermon"])
    await _seed(
        db_sessionmaker,
        [("vid00000002", "Two", "Scripture: Psalm 23")],
        tags=["sermon"],
        source_id=2,
    )

    await _place(db_sessionmaker, source_id=1)
    await _place(db_sessionmaker, source_id=2)

    async with db_sessionmaker() as db:
        names = list((await db.execute(select(Tag.name))).scalars())
    assert sorted(names) == ["sermon"]
    assert len(await _notes(db_sessionmaker)) == 2


async def test_a_video_noted_by_hand_since_the_fetch_is_not_noted_again(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The gap between fetching and reading is real, not hypothetical.

    A `pending` row can be days old — leftovers from earlier runs are read too — so a note made by
    hand in between would be duplicated if the fetch's answer were simply trusted.
    """
    await _seed(db_sessionmaker, [("vid00000001", "A study", "Scripture: John 3:16")])
    async with db_sessionmaker() as db:
        db.add(
            SermonNote(
                title="Written by hand",
                sermon_url="https://www.youtube.com/watch?v=vid00000001",
                reference="John 3:16",
                book_usfm="JHN",
                book_order_index=43,
                start_chapter=3,
                start_verse=16,
                end_chapter=3,
                end_verse=16,
                author_id=1,
            )
        )
        await db.commit()

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert (row.status, row.placed_by) == ("already_noted", None)
    assert row.decided_at is not None
    assert [n.title for n in await _notes(db_sessionmaker)] == ["Written by hand"]


async def test_another_users_note_does_not_stop_this_one_being_placed(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    async with db_sessionmaker() as db:
        db.add(User(id=2, name="someone else"))
        await db.commit()
    await _seed(db_sessionmaker, [("vid00000001", "A study", "Scripture: John 3:16")])
    async with db_sessionmaker() as db:
        db.add(
            SermonNote(
                title="Theirs",
                sermon_url="https://www.youtube.com/watch?v=vid00000001",
                reference="John 3:16",
                book_usfm="JHN",
                book_order_index=43,
                start_chapter=3,
                start_verse=16,
                end_chapter=3,
                end_verse=16,
                author_id=2,
            )
        )
        await db.commit()

    await _place(db_sessionmaker)

    row = (await _rows(db_sessionmaker))["vid00000001"]
    assert row.status == "placed"
    assert sorted(n.author_id for n in await _notes(db_sessionmaker)) == [1, 2]


async def test_a_row_that_has_left_pending_is_never_read_again(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Once a video is in the review list it is a person's to decide; a later check must not
    # quietly overrule them, even if the rules would now find something.
    await _seed(db_sessionmaker, [("vid00000001", "A study", "Scripture: John 3:16")])
    async with db_sessionmaker() as db:
        row = (await db.execute(select(SermonSourceVideo))).scalar_one()
        row.status = "dismissed"
        await db.commit()

    await _place(db_sessionmaker)

    assert await _notes(db_sessionmaker) == []
    assert (await _rows(db_sessionmaker))["vid00000001"].status == "dismissed"


async def test_a_source_with_nothing_pending_does_no_work_at_all(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The common weekly case, and the reason for the early return.

    No lookups, and — the part worth counting — no boilerplate pass either. That pass reads every
    description this source has ever ledgered, which on a real church is a thousand of them, and
    doing it to decide nothing is the difference between a check that costs nothing at rest and one
    that does not.
    """
    concord = _concord()
    await _seed(db_sessionmaker, [("vid00000001", "A study", "Scripture: John 3:16")])
    async with db_sessionmaker() as db:
        row = (await db.execute(select(SermonSourceVideo))).scalar_one()
        row.status = "already_noted"
        await db.commit()

    engine = db_sessionmaker.kw["bind"]
    reads: list[str] = []

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _record(_conn: object, _cur: object, statement: str, *_rest: object) -> None:
        reads.append(statement)

    try:
        await _place(db_sessionmaker, concord)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _record)

    assert concord.resolve_calls == []
    # Nothing went looking for the text a passage is read out of.
    assert not [s for s in reads if "description" in s]


# ---- Concord going away, mid-run ---------------------------------------------------------------


class _DiesAfterOne(FakeConcordClient):
    """Answers the first reference it is asked for, then becomes unreachable."""

    def __init__(self) -> None:
        super().__init__(resolved_by_ref=_KNOWN, books=_BOOKS)
        self._answered = 0

    async def resolve_reference(self, ref: str) -> Chapter:
        if self._answered >= 1:
            raise ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
        self._answered += 1
        return await super().resolve_reference(ref)


async def test_concord_going_away_keeps_what_was_placed_and_leaves_the_rest_pending(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(
        db_sessionmaker,
        [
            ("vid00000001", "One", "Scripture: John 3:16"),
            ("vid00000002", "Two", "Scripture: Psalm 23"),
        ],
    )

    with pytest.raises(ConcordUnreachableError):
        await _place(db_sessionmaker, _DiesAfterOne())

    rows = await _rows(db_sessionmaker)
    assert rows["vid00000001"].status == "placed"
    # Untouched, so the next check reads it — none of the fetching is lost.
    assert (rows["vid00000002"].status, rows["vid00000002"].decided_at) == ("pending", None)
    assert [n.reference for n in await _notes(db_sessionmaker)] == ["John 3:16"]


def _video(video_id: str, title: str, description: str) -> Video:
    return Video(
        id=video_id,
        title=title,
        description=description,
        published_at=_PUBLISHED,
        live_broadcast_content="none",
        duration_seconds=3600,
        actual_start_time=None,
        is_livestream=False,
        channel_id=_CHANNEL_ID,
        channel_title="A Church",
    )


async def test_a_run_keeps_fetching_after_concord_goes_away(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The whole point of the `pending` seam.

    Concord being unreachable stops the reading, not the fetching: the quota is spent once, the
    ledger fills up, and only the passages wait for the next check. Both sources say so on their
    cards rather than claiming the check went fine.
    """
    ids = ["vid00000001", "vid00000002"]
    youtube = FakeYouTubeClient(
        videos=[_video(i, f"Sermon {i}", "Scripture: John 3:16") for i in ids],
        pages={_UPLOADS: [[ids[0]]], f"{_UPLOADS}2": [[ids[1]]]},
    )

    async with db_sessionmaker() as db:
        for source_id, uploads in ((1, _UPLOADS), (2, f"{_UPLOADS}2")):
            db.add(
                SermonSource(
                    id=source_id,
                    kind="channel",
                    youtube_id=f"UC{source_id}",
                    uploads_playlist_id=uploads,
                    input_url="https://www.youtube.com/@achurch",
                    title=f"Church {source_id}",
                    author_id=1,
                )
            )
        await db.commit()

    concord = FakeConcordClient(
        error=ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    )
    runner = ScanRunner(
        db_sessionmaker,
        youtube,  # type: ignore[arg-type]
        concord,  # type: ignore[arg-type]
        default_min_minutes=10,
    )
    await runner.run()

    # Asked once, for the first source's first candidate, and never again. Concord being down is a
    # fact about Concord: rediscovering it per source would be a round trip each for nothing.
    assert concord.resolve_calls == ["John 3:16"]

    # Both catalogues were walked and ledgered — YouTube was never the problem.
    rows = await _rows(db_sessionmaker)
    assert sorted(rows) == ids
    assert {row.status for row in rows.values()} == {"pending"}
    async with db_sessionmaker() as db:
        sources = list((await db.execute(select(SermonSource))).scalars())
    assert {s.last_check_status for s in sources} == {STATUS_CONCORD_DOWN}
    # The walk finished, so the next check may still trust the incremental stop rule.
    assert all(s.scan_complete for s in sources)


async def test_a_check_that_reads_every_passage_records_a_plain_ok(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    youtube = FakeYouTubeClient(
        videos=[_video("vid00000001", "A study", "Scripture: John 3:16")],
        pages={_UPLOADS: [["vid00000001"]]},
    )
    async with db_sessionmaker() as db:
        db.add(
            SermonSource(
                id=1,
                kind="channel",
                youtube_id=_CHANNEL_ID,
                uploads_playlist_id=_UPLOADS,
                input_url="https://www.youtube.com/@achurch",
                title="A Church",
                author_id=1,
            )
        )
        await db.commit()

    runner = ScanRunner(
        db_sessionmaker,
        youtube,  # type: ignore[arg-type]
        _concord(),  # type: ignore[arg-type]
        default_min_minutes=10,
    )
    await runner.run()

    async with db_sessionmaker() as db:
        source = await db.get(SermonSource, 1)
    assert source is not None and source.last_check_status == STATUS_OK
    assert (await _rows(db_sessionmaker))["vid00000001"].status == "placed"
    assert [n.reference for n in await _notes(db_sessionmaker)] == ["John 3:16"]


# ---- The bridge (invariant 4) ------------------------------------------------------------------


async def test_a_scan_created_note_shows_in_a_translation_the_scan_never_saw(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    """The load-bearing wall (CLAUDE.md invariant 4), for a note nobody typed.

    A check anchors to an ADDRESS — JHN 3:16 — not to a rendering. The fixture above resolved that
    address through a Concord serving KJV; the chapter is read back here in WEB, a translation the
    check never touched, and the note has to be on the right verse and nowhere else.
    """
    await _seed(db_sessionmaker, [("vid00000001", "Born again", "Scripture: John 3:16")])
    await _place(db_sessionmaker)
    created = await _notes(db_sessionmaker)
    assert len(created) == 1

    web = make_concord(chapter=build_chapter("JHN", 3, "WEB", verses=20))
    async with client_for(web) as client:
        read = (await client.get("/api/v1/read/WEB/JHN/3")).json()

    by_verse = {v["verse"]: v for v in read["verses"]}
    assert [n["id"] for n in by_verse[16]["sermon_notes"]] == [created[0].id]
    assert by_verse[15]["sermon_notes"] == []
    assert by_verse[17]["sermon_notes"] == []
    assert read["translation"] == "WEB"


async def test_an_evaluation_that_blows_up_does_not_condemn_the_walk(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Two different facts, and only one of them is about paging.

    `scan_complete` means "the catalogue was walked to its natural stop", and the next check reads
    it to decide whether it may trust the incremental stop rule. A bug in the reading half has
    nothing to say about that — writing False there would make every future check re-walk the whole
    catalogue to atone for something that happened after the walk was over.
    """

    class Explodes(FakeConcordClient):
        async def list_books(self) -> list[Book]:
            raise RuntimeError("a bug, not a network")

    youtube = FakeYouTubeClient(
        videos=[_video("vid00000001", "A study", "Scripture: John 3:16")],
        pages={_UPLOADS: [["vid00000001"]]},
    )
    async with db_sessionmaker() as db:
        db.add(
            SermonSource(
                id=1,
                kind="channel",
                youtube_id=_CHANNEL_ID,
                uploads_playlist_id=_UPLOADS,
                input_url="https://www.youtube.com/@achurch",
                title="A Church",
                author_id=1,
            )
        )
        await db.commit()

    runner = ScanRunner(
        db_sessionmaker,
        youtube,  # type: ignore[arg-type]
        Explodes(resolved_by_ref=_KNOWN),  # type: ignore[arg-type]
        default_min_minutes=10,
    )
    await runner.run()

    async with db_sessionmaker() as db:
        source = await db.get(SermonSource, 1)
    assert source is not None
    # The owner is told something went wrong, in the words that say nothing technical...
    assert source.last_check_status == STATUS_UNKNOWN
    # ...and the catalogue is still known to be complete.
    assert source.scan_complete is True
    # The video was fetched and is waiting to be read again.
    assert (await _rows(db_sessionmaker))["vid00000001"].status == "pending"
