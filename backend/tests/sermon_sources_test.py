"""Sermon sources CRUD (v1.7 sermon sources, spec §4-5, §9).

Adding a source resolves the pasted link through YouTube once and stores what came back; nothing
is scanned (that is slice 4). Synthetic fixtures and a fake YouTube throughout — the live
acceptance against the four real churches is recorded in dev-notes, not run here.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import FastAPI
from songbird.api.deps import get_scan_runner_optional
from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo, Tag, User
from songbird.youtube.client import YouTubeAuthError, YouTubeQuotaError, YouTubeUnreachableError
from songbird.youtube.schemas import Channel, Playlist
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient, FakeYouTubeClient

# The four real churches this feature exists for are in dev-notes; these are their shapes.
_HANDLE = "@cornerstonechpl"
_CHANNEL_ID = "UCa1b2c3d4e5f6g7h8i9j0k1"
_UPLOADS_ID = "UUa1b2c3d4e5f6g7h8i9j0k1"
_CHANNEL_TITLE = "Cornerstone Chapel"

_PLAYLIST_ID = "PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t"
_PLAYLIST_TITLE = "Sunday Teaching"

_HANDLE_URL = f"https://www.youtube.com/{_HANDLE}"
_CHANNEL_URL = f"https://www.youtube.com/channel/{_CHANNEL_ID}"
_PLAYLIST_URL = f"https://www.youtube.com/playlist?list={_PLAYLIST_ID}"

_CHANNEL = Channel(id=_CHANNEL_ID, title=_CHANNEL_TITLE, uploads_playlist_id=_UPLOADS_ID)
_PLAYLIST = Playlist(id=_PLAYLIST_ID, title=_PLAYLIST_TITLE)


def _youtube() -> FakeYouTubeClient:
    """A YouTube that knows the one channel, by handle AND by id, plus the one playlist."""
    return FakeYouTubeClient(
        channels={_HANDLE: _CHANNEL, _CHANNEL_ID: _CHANNEL},
        playlists={_PLAYLIST_ID: _PLAYLIST},
    )


async def _row(sessionmaker: async_sessionmaker[AsyncSession], source_id: int) -> SermonSource:
    async with sessionmaker() as session:
        source = await session.get(SermonSource, source_id)
        assert source is not None
        return source


async def _add_other_user(sessionmaker: async_sessionmaker[AsyncSession]) -> None:
    async with sessionmaker() as session:  # user 1 is seeded by the fixture
        session.add(User(id=2, name="someone-else", created_at=datetime.now(UTC)))
        await session.commit()


# ---- Adding: every link form the parser accepts ----------------------------------------------


async def test_a_handle_link_stores_the_channel_id_uploads_list_and_title(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    youtube = _youtube()
    with_youtube(youtube)
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})

    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "channel"
    assert body["youtube_id"] == _CHANNEL_ID
    assert body["uploads_playlist_id"] == _UPLOADS_ID
    assert body["title"] == _CHANNEL_TITLE
    # The pasted link is kept as-is, so the owner recognises what they added.
    assert body["input_url"] == _HANDLE_URL
    # A handle is RESOLVED, not fetched — different call, and the one the parser's kind selects.
    assert youtube.lookups == [("handle", _HANDLE)]


async def test_a_channel_id_link_is_fetched_rather_than_resolved(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    youtube = _youtube()
    with_youtube(youtube)
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _CHANNEL_URL})

    assert resp.status_code == 201
    assert resp.json()["youtube_id"] == _CHANNEL_ID
    assert youtube.lookups == [("channel", _CHANNEL_ID)]


async def test_a_bare_handle_works_the_same_as_its_link(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Typed rather than pasted — the form a person says out loud.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE})

    assert resp.status_code == 201
    assert resp.json()["youtube_id"] == _CHANNEL_ID


async def test_a_playlist_link_stores_a_playlist_with_no_uploads_list(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # A playlist IS its own catalogue, so there is no second id to keep (spec §4).
    youtube = _youtube()
    with_youtube(youtube)
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _PLAYLIST_URL})

    assert resp.status_code == 201
    body = resp.json()
    assert body["kind"] == "playlist"
    assert body["youtube_id"] == _PLAYLIST_ID
    assert body["uploads_playlist_id"] is None
    assert body["title"] == _PLAYLIST_TITLE
    assert youtube.lookups == [("playlist", _PLAYLIST_ID)]


async def test_the_filter_defaults_are_include_live_and_the_app_wide_minimum(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Past livestreams count by default (spec §4) — for most churches they ARE the sermons. And
    # `min_minutes` stays null so the source FOLLOWS SERMON_MIN_MINUTES rather than pinning a
    # copy of today's value.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})

    body = resp.json()
    assert body["include_live"] is True
    assert body["enabled"] is True
    assert body["min_minutes"] is None
    # Never checked yet — the UI reads both of these as "never".
    assert body["last_checked_at"] is None
    assert body["last_check_status"] is None


# ---- Adding: the failures ---------------------------------------------------------------------


async def test_a_link_songbird_cannot_read_is_422_and_asks_for_the_handle(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # The old /c/ form is the case this message exists for: it cannot be resolved through the
    # Data API at all, and nothing about the failure hints at what to paste instead.
    youtube = _youtube()
    with_youtube(youtube)
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post(
            "/api/v1/sermon-sources",
            json={"url": "https://www.youtube.com/c/CornerstoneChapel"},
        )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "INVALID_SOURCE_URL"
    assert "@handle" in detail["message"]
    # Rejected before any lookup — a link we know we can't use must not spend a quota unit.
    assert youtube.lookups == []


async def test_a_channel_youtube_does_not_know_is_a_404_not_a_500(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # A well-formed handle for a channel that isn't there. YouTube answers 200-with-no-items;
    # the client turns that into a not-found and this turns it into a plain 404.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post(
            "/api/v1/sermon-sources", json={"url": "https://www.youtube.com/@nosuchchurchhere"}
        )

    assert resp.status_code == 404
    assert "@nosuchchurchhere" in resp.json()["detail"]["message"]


async def test_the_same_source_twice_is_409_naming_what_you_already_have(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        first = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})
        # The SAME channel reached by its other link form — the duplicate check is on the
        # resolved id, not on the pasted text, or this would slip through.
        second = await client.post("/api/v1/sermon-sources", json={"url": _CHANNEL_URL})

    assert first.status_code == 201
    assert second.status_code == 409
    detail = second.json()["detail"]
    assert detail["code"] == "SOURCE_EXISTS"
    assert _CHANNEL_TITLE in detail["message"]


async def test_two_users_may_follow_the_same_church(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # The unique constraint is (author_id, youtube_id), not youtube_id alone.
    await _add_other_user(db_sessionmaker)
    async with db_sessionmaker() as session:
        session.add(
            SermonSource(
                kind="channel",
                youtube_id=_CHANNEL_ID,
                uploads_playlist_id=_UPLOADS_ID,
                input_url=_HANDLE_URL,
                title=_CHANNEL_TITLE,
                author_id=2,
            )
        )
        await session.commit()

    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})

    assert resp.status_code == 201


async def test_adding_without_a_key_is_409_not_a_crash(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # No `with_youtube` — the fast suite never runs the lifespan, so this is the real "no key"
    # path. The feature being off is a normal state, not a server fault (spec §2).
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "YOUTUBE_NOT_CONFIGURED"


async def test_youtube_failures_map_the_way_the_redate_maps_them(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    cases: tuple[tuple[Exception, int, str], ...] = (
        (YouTubeQuotaError("spent", status=403, reason="quotaExceeded"), 429, "YOUTUBE_QUOTA"),
        (
            YouTubeAuthError("rejected", status=400, reason="API_KEY_INVALID"),
            502,
            "YOUTUBE_KEY_REJECTED",
        ),
        (YouTubeUnreachableError("down"), 502, "YOUTUBE_UNREACHABLE"),
    )
    for error, expected_status, expected_code in cases:
        with_youtube(FakeYouTubeClient(error=error))
        async with client_for(FakeConcordClient()) as client:
            resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})
        assert resp.status_code == expected_status, expected_code
        assert resp.json()["detail"]["code"] == expected_code


async def test_the_key_rejected_message_names_the_setting_and_never_a_key(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    secret = "AIzaSyA0000000000000000000000000000000b"
    with_youtube(
        FakeYouTubeClient(
            error=YouTubeAuthError(f"rejected {secret}", status=400, reason="API_KEY_INVALID")
        )
    )
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})

    message = resp.json()["detail"]["message"]
    assert "YOUTUBE_API_KEY" in message
    assert secret not in message
    # Google's own token is safe to show, and is what tells an admin WHICH way the key is wrong.
    assert "API_KEY_INVALID" in message


async def test_a_minimum_below_one_minute_is_rejected(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # A zero-minute floor filters nothing and a negative one is nonsense.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        for bad in (0, -5):
            resp = await client.post(
                "/api/v1/sermon-sources", json={"url": _HANDLE_URL, "min_minutes": bad}
            )
            assert resp.status_code == 422, bad


# ---- Tags: the same vocabulary as everything else ---------------------------------------------


async def test_tags_are_normalized_and_join_the_shared_vocabulary(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post(
            "/api/v1/sermon-sources",
            json={"url": _HANDLE_URL, "tags": ["  Sunday  ", "TEACHING", "sunday"]},
        )
        tags = await client.get("/api/v1/tags")

    # Trimmed, lowercased, de-duped — the same normalization every other tag goes through.
    assert created.json()["tags"] == ["sunday", "teaching"]
    # And visible in the type-ahead, which is the point of sharing one table rather than
    # keeping a parallel set (spec §4).
    assert tags.json() == ["sunday", "teaching"]


async def test_a_tag_left_on_no_source_stops_being_offered(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Orphan tags must not surface as filters or autocomplete — the rule the other two note
    # kinds already follow.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post(
            "/api/v1/sermon-sources", json={"url": _HANDLE_URL, "tags": ["sunday"]}
        )
        source_id = created.json()["id"]
        await client.delete(f"/api/v1/sermon-sources/{source_id}")
        tags = await client.get("/api/v1/tags")

    assert tags.json() == []


# ---- Listing ---------------------------------------------------------------------------------


async def test_sources_are_listed_newest_first(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Seeded so that neither id-ascending nor id-descending is accidentally the right answer:
    # the newest row has the LOWEST id, and the oldest has the middle one.
    base = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    seeded = (
        (10, "Newest", base + timedelta(days=2)),
        (30, "Middle", base + timedelta(days=1)),
        (20, "Oldest", base),
    )
    async with db_sessionmaker() as session:
        for source_id, title, created in seeded:
            session.add(
                SermonSource(
                    id=source_id,
                    kind="channel",
                    youtube_id=f"UC{source_id:022d}",
                    uploads_playlist_id=f"UU{source_id:022d}",
                    input_url=f"https://www.youtube.com/channel/UC{source_id:022d}",
                    title=title,
                    author_id=1,
                    created_at=created,
                    updated_at=created,
                )
            )
        await session.commit()

    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources")

    titles = [s["title"] for s in resp.json()]
    assert titles == ["Newest", "Middle", "Oldest"]


async def test_another_users_sources_are_not_listed(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _add_other_user(db_sessionmaker)
    async with db_sessionmaker() as session:
        session.add(
            SermonSource(
                kind="channel",
                youtube_id="UCtheirchannelid00000000",
                input_url="https://www.youtube.com/@theirs",
                title="Someone else's church",
                author_id=2,
            )
        )
        await session.commit()

    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})
        resp = await client.get("/api/v1/sermon-sources")

    assert [s["title"] for s in resp.json()] == [_CHANNEL_TITLE]


# ---- Editing ----------------------------------------------------------------------------------


async def test_each_editable_field_can_be_changed(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post(
            "/api/v1/sermon-sources", json={"url": _HANDLE_URL, "tags": ["sunday"]}
        )
        source_id = created.json()["id"]
        resp = await client.patch(
            f"/api/v1/sermon-sources/{source_id}",
            json={
                "enabled": False,
                "include_live": False,
                "min_minutes": 25,
                "tags": ["evening", "midweek"],
            },
        )

    body = resp.json()
    assert body["enabled"] is False
    assert body["include_live"] is False
    assert body["min_minutes"] == 25
    assert body["tags"] == ["evening", "midweek"]


async def test_a_patch_that_mentions_nothing_changes_nothing(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post(
            "/api/v1/sermon-sources",
            json={"url": _HANDLE_URL, "tags": ["sunday"], "min_minutes": 25},
        )
        source_id = created.json()["id"]
        resp = await client.patch(f"/api/v1/sermon-sources/{source_id}", json={})

    body = resp.json()
    assert body["min_minutes"] == 25
    assert body["tags"] == ["sunday"]
    assert body["include_live"] is True


async def test_a_null_minimum_restores_the_app_wide_default(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # The pair that makes `model_fields_set` load-bearing: an ABSENT min_minutes means "leave it"
    # (the test above), a NULL one means "follow SERMON_MIN_MINUTES again". Telling them apart is
    # the only way an override can ever be cleared.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post(
            "/api/v1/sermon-sources", json={"url": _HANDLE_URL, "min_minutes": 25}
        )
        source_id = created.json()["id"]
        resp = await client.patch(f"/api/v1/sermon-sources/{source_id}", json={"min_minutes": None})

    assert resp.json()["min_minutes"] is None
    assert (await _row(db_sessionmaker, source_id)).min_minutes is None


async def test_the_url_and_identity_cannot_be_edited(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # To point songbird at a different channel you delete and re-add, so a source's ledger can
    # never be silently reattached to a catalogue it didn't come from.
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})
        source_id = created.json()["id"]
        resp = await client.patch(
            f"/api/v1/sermon-sources/{source_id}",
            json={
                "url": "https://www.youtube.com/@someoneelse",
                "youtube_id": "UCsomethingelse000000000",
                "title": "Renamed",
            },
        )

    assert resp.status_code == 200
    row = await _row(db_sessionmaker, source_id)
    assert row.input_url == _HANDLE_URL
    assert row.youtube_id == _CHANNEL_ID
    assert row.title == _CHANNEL_TITLE


# ---- Fetching, deleting, and the author scope -------------------------------------------------


async def test_one_source_can_be_fetched_by_id(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})
        resp = await client.get(f"/api/v1/sermon-sources/{created.json()['id']}")

    assert resp.status_code == 200
    assert resp.json()["youtube_id"] == _CHANNEL_ID


async def test_deleting_a_source_removes_it(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})
        source_id = created.json()["id"]
        deleted = await client.delete(f"/api/v1/sermon-sources/{source_id}")
        gone = await client.get(f"/api/v1/sermon-sources/{source_id}")

    assert deleted.status_code == 204
    assert gone.status_code == 404
    async with db_sessionmaker() as session:
        assert await session.get(SermonSource, source_id) is None


async def test_deleting_a_source_never_deletes_a_sermon_note(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    """Spec §9: the ledger goes with a deleted source; the notes it created stay.

    Trivially true today, because nothing links the two yet — but slice 4 gives a sermon note a
    foreign key back to the ledger row that made it, and that is exactly the change that could
    turn this into a cascade nobody intended. The guard lands before the thing it guards.
    """
    async with db_sessionmaker() as session:
        note = SermonNote(
            title="A sermon someone wrote about",
            sermon_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            reference="JHN 3:16",
            book_usfm="JHN",
            book_order_index=43,
            start_chapter=3,
            start_verse=16,
            end_chapter=3,
            end_verse=16,
            author_id=1,
            tags=[Tag(name="sunday")],
        )
        session.add(note)
        await session.commit()
        note_id = note.id

    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        created = await client.post(
            "/api/v1/sermon-sources", json={"url": _HANDLE_URL, "tags": ["sunday"]}
        )
        await client.delete(f"/api/v1/sermon-sources/{created.json()['id']}")
        notes = await client.get("/api/v1/sermon-notes")

    assert [n["id"] for n in notes.json()] == [note_id]
    async with db_sessionmaker() as session:
        assert await session.get(SermonNote, note_id) is not None
        # The shared tag survives too — it is still on the note.
        assert (await session.execute(select(Tag.name))).scalars().all() == ["sunday"]


async def test_another_users_source_is_a_404_on_every_verb(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A 404 rather than a 403: another user's source must not even be known to exist.
    await _add_other_user(db_sessionmaker)
    async with db_sessionmaker() as session:
        source = SermonSource(
            kind="channel",
            youtube_id="UCtheirchannelid00000000",
            input_url="https://www.youtube.com/@theirs",
            title="Someone else's church",
            author_id=2,
        )
        session.add(source)
        await session.commit()
        theirs = source.id

    async with client_for(FakeConcordClient()) as client:
        got = await client.get(f"/api/v1/sermon-sources/{theirs}")
        patched = await client.patch(f"/api/v1/sermon-sources/{theirs}", json={"enabled": False})
        deleted = await client.delete(f"/api/v1/sermon-sources/{theirs}")

    for resp in (got, patched, deleted):
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "SOURCE_NOT_FOUND"

    # And it is still there afterwards.
    async with db_sessionmaker() as session:
        assert await session.get(SermonSource, theirs) is not None


# ---- Status -----------------------------------------------------------------------------------


async def test_status_reports_no_key_without_failing(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # THE reason this endpoint doesn't use the demanding dependency: with no key it has to
    # ANSWER, because that answer is what the page renders as its setup message.
    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources/status")

    assert resp.status_code == 200
    # The whole shape, so a field added later has to be added here deliberately. `scan_running`
    # is false because the fast suite never runs the lifespan and so has no runner — which is
    # exactly the "answer, don't fail" property this endpoint exists for, now applied twice.
    assert resp.json() == {
        "configured": False,
        "min_minutes_default": 10,
        "scan_running": False,
        "scan_started_at": None,
    }


async def test_status_reports_a_configured_key(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    with_youtube(_youtube())
    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources/status")

    assert resp.json()["configured"] is True


async def test_status_is_not_read_as_a_source_id(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # FastAPI matches routes in registration order, so /status has to be declared before
    # /{source_id}. Declared the other way round this is a 422 on the int parse.
    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources/status")

    assert resp.status_code == 200
    assert "configured" in resp.json()


# ---- Checking, counts and the ledger (v1.7 slice 4a) -------------------------------------------

_VIDEO_IDS = ["vid00000001", "vid00000002", "vid00000003"]


async def _seed_ledger(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    source_id: int,
    author_id: int = 1,
    rows: tuple[tuple[str, str, str | None], ...] = (),
    published: datetime | None = None,
) -> None:
    """Ledger rows as (video_id, status, skip_reason), newest first by default."""
    base = published or datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    async with sessionmaker() as session:
        for index, (video_id, row_status, reason) in enumerate(rows):
            session.add(
                SermonSourceVideo(
                    source_id=source_id,
                    author_id=author_id,
                    video_id=video_id,
                    title=f"Sermon {video_id}",
                    description="Main Scripture: Acts 7:33-35",
                    published_at=base - timedelta(days=index),
                    duration_seconds=3600,
                    status=row_status,
                    skip_reason=reason,
                    seen_at=base,
                )
            )
        await session.commit()


async def _seed_source_row(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    source_id: int = 1,
    author_id: int = 1,
    enabled: bool = True,
    youtube_id: str | None = None,
) -> int:
    async with sessionmaker() as session:
        session.add(
            SermonSource(
                id=source_id,
                kind="channel",
                youtube_id=youtube_id or f"UC{source_id:022d}",
                uploads_playlist_id=f"UU{source_id:022d}",
                input_url="https://www.youtube.com/@achurch",
                title=f"Church {source_id}",
                enabled=enabled,
                author_id=author_id,
            )
        )
        await session.commit()
    return source_id


class _RecordingRunner:
    """Stands in for the scan runner so a route test asserts what was ASKED for, not what a
    background task then did. The real runner has its own suite."""

    def __init__(self) -> None:
        self.requests = 0
        self.started_at: datetime | None = None
        self.running = False

    def request_scan(self) -> None:
        self.requests += 1


def _with_runner(app: object) -> _RecordingRunner:
    runner = _RecordingRunner()
    app.dependency_overrides[get_scan_runner_optional] = lambda: runner  # type: ignore[attr-defined]
    return runner


async def test_adding_a_source_queues_its_first_catalogue_scan(
    app: FastAPI,
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Spec §5: adding a source scans the whole back catalogue. The request is written down and
    # the response comes back straight away — 201, because a source really was created.
    with_youtube(_youtube())
    runner = _with_runner(app)
    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources", json={"url": _HANDLE_URL})

    assert resp.status_code == 201
    assert (await _row(db_sessionmaker, resp.json()["id"])).check_requested_at is not None
    assert runner.requests == 1


async def test_check_all_queues_every_enabled_source(
    app: FastAPI,
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    with_youtube(_youtube())
    runner = _with_runner(app)
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_source_row(db_sessionmaker, source_id=2)
    await _seed_source_row(db_sessionmaker, source_id=3, enabled=False)

    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources/check")

    # 202: accepted, not finished. The count is what went into the queue, not what was found.
    assert resp.status_code == 202
    assert resp.json() == {"queued": 2}
    assert runner.requests == 1
    # The paused one is left alone entirely — the runner would never pick it up, and a stamp it
    # never serves would leave the row reading "waiting to be checked" for ever.
    assert (await _row(db_sessionmaker, 3)).check_requested_at is None
    assert (await _row(db_sessionmaker, 1)).check_requested_at is not None


async def test_check_all_with_nothing_enabled_is_still_accepted(
    app: FastAPI,
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Nothing failed — the request was accepted and there was nothing in it. The page says so in
    # words rather than showing an error for a state the owner deliberately chose.
    with_youtube(_youtube())
    runner = _with_runner(app)
    await _seed_source_row(db_sessionmaker, source_id=1, enabled=False)

    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources/check")

    assert resp.status_code == 202
    assert resp.json() == {"queued": 0}
    assert runner.requests == 0  # nothing to do, so the runner is not woken


async def test_checking_one_source_queues_only_that_one(
    app: FastAPI,
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    with_youtube(_youtube())
    runner = _with_runner(app)
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_source_row(db_sessionmaker, source_id=2)

    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources/1/check")

    assert resp.status_code == 202
    assert resp.json() == {"queued": 1}
    assert runner.requests == 1
    assert (await _row(db_sessionmaker, 1)).check_requested_at is not None
    assert (await _row(db_sessionmaker, 2)).check_requested_at is None


async def test_checking_a_paused_source_queues_nothing(
    app: FastAPI,
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    with_youtube(_youtube())
    runner = _with_runner(app)
    await _seed_source_row(db_sessionmaker, source_id=1, enabled=False)

    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources/1/check")

    assert resp.status_code == 202
    assert resp.json() == {"queued": 0}
    assert runner.requests == 0
    # Not stamped: the runner never picks up a paused source, so this would never be served.
    assert (await _row(db_sessionmaker, 1)).check_requested_at is None


async def test_checking_needs_a_key(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Queueing work that could never run would be a lie told in the friendliest possible way.
    await _seed_source_row(db_sessionmaker, source_id=1)
    async with client_for(FakeConcordClient()) as client:
        both = (
            await client.post("/api/v1/sermon-sources/check"),
            await client.post("/api/v1/sermon-sources/1/check"),
        )

    for resp in both:
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "YOUTUBE_NOT_CONFIGURED"
    assert (await _row(db_sessionmaker, 1)).check_requested_at is None


async def test_checking_another_users_source_is_a_404(
    app: FastAPI,
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    with_youtube(_youtube())
    _with_runner(app)
    await _add_other_user(db_sessionmaker)
    await _seed_source_row(db_sessionmaker, source_id=9, author_id=2)

    async with client_for(FakeConcordClient()) as client:
        resp = await client.post("/api/v1/sermon-sources/9/check")

    assert resp.status_code == 404
    assert (await _row(db_sessionmaker, 9)).check_requested_at is None


async def test_each_source_carries_its_own_ledger_counts(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_source_row(db_sessionmaker, source_id=2)
    await _seed_ledger(
        db_sessionmaker,
        source_id=1,
        rows=(
            ("vid00000001", "pending", None),
            ("vid00000002", "pending", None),
            ("vid00000003", "skipped", "too_short"),
            ("vid00000004", "already_noted", None),
        ),
    )
    await _seed_ledger(db_sessionmaker, source_id=2, rows=(("vid00000005", "pending", None),))

    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources")

    by_id = {s["id"]: s["counts"] for s in resp.json()}
    # Every key is always present and zero-filled, so the page never guards a missing one — and
    # the two the placement slice fills are visibly waiting rather than absent.
    assert by_id[1] == {
        "pending": 2,
        "needs_passage": 0,
        "placed": 0,
        "skipped": 1,
        "already_noted": 1,
    }
    assert by_id[2]["pending"] == 1
    assert by_id[2]["skipped"] == 0


async def test_counts_are_on_a_single_source_too(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A documented field that reported zeros on three of the four routes carrying it would be
    # worse than no field at all.
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_ledger(db_sessionmaker, source_id=1, rows=(("vid00000001", "pending", None),))

    async with client_for(FakeConcordClient()) as client:
        got = await client.get("/api/v1/sermon-sources/1")
        patched = await client.patch("/api/v1/sermon-sources/1", json={"enabled": False})

    assert got.json()["counts"]["pending"] == 1
    assert patched.json()["counts"]["pending"] == 1


async def test_counts_never_include_another_users_ledger(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _add_other_user(db_sessionmaker)
    await _seed_source_row(db_sessionmaker, source_id=1, author_id=1)
    await _seed_source_row(db_sessionmaker, source_id=2, author_id=2)
    await _seed_ledger(db_sessionmaker, source_id=1, rows=(("vid00000001", "pending", None),))
    await _seed_ledger(
        db_sessionmaker, source_id=2, author_id=2, rows=(("vid00000002", "pending", None),)
    )

    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources")

    listed = resp.json()
    assert [s["id"] for s in listed] == [1]
    assert listed[0]["counts"]["pending"] == 1


async def test_the_ledger_lists_newest_sermon_first(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_ledger(
        db_sessionmaker,
        source_id=1,
        rows=(
            ("vid00000001", "pending", None),  # newest — _seed_ledger steps a day back per row
            ("vid00000002", "pending", None),
            ("vid00000003", "skipped", "too_short"),
        ),
    )

    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources/videos")

    body = resp.json()
    assert body["total"] == 3
    assert [v["video_id"] for v in body["videos"]] == _VIDEO_IDS
    first = body["videos"][0]
    # The source's name rides along, because the ledger reads as "title · source · date" and must
    # be legible without a second request.
    assert first["source_title"] == "Church 1"
    # The description is bulk text the page never shows, and is deliberately not sent.
    assert "description" not in first


async def test_the_ledger_filters_by_state_and_by_source(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_source_row(db_sessionmaker, source_id=2)
    await _seed_ledger(
        db_sessionmaker,
        source_id=1,
        rows=(("vid00000001", "pending", None), ("vid00000002", "skipped", "too_short")),
    )
    await _seed_ledger(db_sessionmaker, source_id=2, rows=(("vid00000003", "pending", None),))

    async with client_for(FakeConcordClient()) as client:
        # No filter is EVERY state, not spec §9's needs_passage — nothing can be that yet, so
        # that default would answer the first person who opens this view with an empty list.
        everything = await client.get("/api/v1/sermon-sources/videos")
        skipped = await client.get("/api/v1/sermon-sources/videos?status=skipped")
        one_source = await client.get("/api/v1/sermon-sources/videos?source_id=2")
        both = await client.get("/api/v1/sermon-sources/videos?source_id=1&status=pending")
        nonsense = await client.get("/api/v1/sermon-sources/videos?status=banana")

    assert everything.json()["total"] == 3
    assert [v["video_id"] for v in skipped.json()["videos"]] == ["vid00000002"]
    assert skipped.json()["videos"][0]["skip_reason"] == "too_short"
    assert [v["video_id"] for v in one_source.json()["videos"]] == ["vid00000003"]
    assert [v["video_id"] for v in both.json()["videos"]] == ["vid00000001"]
    # The Literal does the validating, so an unknown state is a 422 naming what is allowed.
    assert nonsense.status_code == 422


async def test_the_ledger_pages(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_ledger(
        db_sessionmaker,
        source_id=1,
        rows=tuple((f"vid{n:08d}", "pending", None) for n in range(5)),
    )

    async with client_for(FakeConcordClient()) as client:
        first = await client.get("/api/v1/sermon-sources/videos?limit=2")
        second = await client.get("/api/v1/sermon-sources/videos?limit=2&offset=2")
        too_many = await client.get("/api/v1/sermon-sources/videos?limit=500")

    # `total` is the whole set, not the page — it is what drives "Load more".
    assert first.json()["total"] == 5
    assert len(first.json()["videos"]) == 2
    # The pages do not overlap, which is what the id tiebreak in the ordering is there for.
    assert {v["video_id"] for v in first.json()["videos"]}.isdisjoint(
        {v["video_id"] for v in second.json()["videos"]}
    )
    assert too_many.status_code == 422  # a page has an upper bound


async def test_the_ledger_never_shows_another_users_videos(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    await _add_other_user(db_sessionmaker)
    await _seed_source_row(db_sessionmaker, source_id=1, author_id=1)
    await _seed_source_row(db_sessionmaker, source_id=9, author_id=2)
    await _seed_ledger(db_sessionmaker, source_id=1, rows=(("vid00000001", "pending", None),))
    await _seed_ledger(
        db_sessionmaker, source_id=9, author_id=2, rows=(("vid00000002", "pending", None),)
    )

    async with client_for(FakeConcordClient()) as client:
        mine = await client.get("/api/v1/sermon-sources/videos")
        theirs = await client.get("/api/v1/sermon-sources/videos?source_id=9")

    assert [v["video_id"] for v in mine.json()["videos"]] == ["vid00000001"]
    # Filtering by someone else's source is a 404, not an empty page: an id that isn't yours must
    # not read as "nothing found".
    assert theirs.status_code == 404


async def test_videos_is_not_read_as_a_source_id(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The same trap `/status` documents: FastAPI matches the path pattern BEFORE converting the
    # int, so a `/videos` declared after `/{source_id}` would 422 on int("videos").
    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources/videos")

    assert resp.status_code == 200
    assert resp.json() == {"videos": [], "total": 0}


async def test_the_ledger_reads_without_a_youtube_key(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A key rotated out or revoked must not take away the record of what was already found
    # (spec §2). No `with_youtube` here, which is how a test says "no key".
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_ledger(db_sessionmaker, source_id=1, rows=(("vid00000001", "pending", None),))

    async with client_for(FakeConcordClient()) as client:
        resp = await client.get("/api/v1/sermon-sources/videos")

    assert resp.status_code == 200
    assert resp.json()["total"] == 1


async def test_deleting_a_source_takes_its_ledger_and_leaves_the_notes(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Spec §9, and the cascade SQLite will not do for us.

    `ondelete="CASCADE"` never fires here: SQLite enforces foreign keys only when PRAGMA
    foreign_keys is on and songbird never turns it on, so without an explicit delete the ledger
    rows would simply be orphaned. Slice 3's tag cascade works only because SQLAlchemy manages
    `secondary` join rows itself; a plain child table gets no such help.
    """
    await _seed_source_row(db_sessionmaker, source_id=1)
    await _seed_source_row(db_sessionmaker, source_id=2)
    await _seed_ledger(db_sessionmaker, source_id=1, rows=(("vid00000001", "pending", None),))
    await _seed_ledger(db_sessionmaker, source_id=2, rows=(("vid00000002", "pending", None),))
    async with db_sessionmaker() as session:
        session.add(
            SermonNote(
                title="Written by hand",
                sermon_url="https://www.youtube.com/watch?v=vid00000001",
                reference="JHN 3:16",
                book_usfm="JHN",
                book_order_index=43,
                start_chapter=3,
                start_verse=16,
                end_chapter=3,
                end_verse=16,
                author_id=1,
            )
        )
        await session.commit()

    async with client_for(FakeConcordClient()) as client:
        deleted = await client.delete("/api/v1/sermon-sources/1")
        notes = await client.get("/api/v1/sermon-notes")

    assert deleted.status_code == 204
    async with db_sessionmaker() as session:
        remaining = (await session.execute(select(SermonSourceVideo.video_id))).scalars().all()
    # Its ledger went with it; the other source's did not.
    assert list(remaining) == ["vid00000002"]
    # And the note about that very video is untouched — deleting where sermons came FROM must
    # never delete what you wrote about them.
    assert [n["title"] for n in notes.json()] == ["Written by hand"]
