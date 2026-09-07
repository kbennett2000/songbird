"""Re-dating sermon notes from YouTube (v1.7 sermon sources, spec §11).

The rule under test is spec §7: a sermon's date is the UTC calendar day of the livestream's
`actualStartTime` when there is one, else of `publishedAt`. Preview writes nothing; apply writes
everything in one commit; a re-run changes nothing. Synthetic fixtures and a fake YouTube — the
live acceptance is recorded in dev-notes, not run here.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime

import httpx
from songbird.concord.schemas import Chapter
from songbird.db.models import SermonNote, User
from songbird.youtube.client import YouTubeAuthError, YouTubeQuotaError, YouTubeUnreachableError
from songbird.youtube.schemas import Video
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient, FakeYouTubeClient
from tests.helpers import DEFAULT_TRANSLATIONS, build_chapter

# A real completed livestream and a real plain upload, in the shapes YouTube returns them.
_STREAM_ID = "uzZFLT6B_Tk"
_UPLOAD_ID = "hWYK_8JQ7-E"
_MISSING_ID = "aaaaaaaaaaa"  # well-formed, but YouTube returns nothing for it

_STREAM_URL = f"https://www.youtube.com/live/{_STREAM_ID}"
_UPLOAD_URL = f"https://www.youtube.com/watch?v={_UPLOAD_ID}"
_MISSING_URL = f"https://www.youtube.com/watch?v={_MISSING_ID}"
_NOT_YOUTUBE_URL = "https://sermons.example.org/2026-01-05"


def _video(
    video_id: str,
    *,
    published_at: datetime,
    actual_start_time: datetime | None = None,
    title: str = "A sermon",
) -> Video:
    return Video(
        id=video_id,
        title=title,
        description="",
        published_at=published_at,
        live_broadcast_content="none",
        duration_seconds=3600,
        actual_start_time=actual_start_time,
        # A recorded start time only ever comes from a liveStreamingDetails block, so a fixture
        # that has one is a stream by construction.
        is_livestream=actual_start_time is not None,
        channel_id="UC_test",
        channel_title="A church",
    )


# The dates below are the ones the real videos carry, so the fixture and the live check agree.
# The stream is the case that makes the rule matter: it started on Sunday 6 September at 14:55
# UTC and was published at 04:32 UTC the NEXT day.
_STREAM_VIDEO = _video(
    _STREAM_ID,
    published_at=datetime(2026, 9, 7, 4, 32, 29, tzinfo=UTC),
    actual_start_time=datetime(2026, 9, 6, 14, 55, 12, tzinfo=UTC),
    title="Livestream Sunday Worship Service -- Sep. 06 2026",
)
_UPLOAD_VIDEO = _video(
    _UPLOAD_ID,
    published_at=datetime(2025, 5, 11, 18, 0, 38, tzinfo=UTC),
    title="Sorrow Gives Birth to Joy",
)
_STREAM_DAY = date(2026, 9, 6)
_UPLOAD_DAY = date(2025, 5, 11)


def _fake_concord(resolved: Chapter | None = None) -> FakeConcordClient:
    return FakeConcordClient(
        chapter=build_chapter("JHN", 3, "KJV", 20),
        resolved=resolved,
        translations=DEFAULT_TRANSLATIONS,
    )


async def _seed(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    sermon_url: str,
    event_date: date | None = None,
    title: str = "A sermon",
    book_order_index: int = 43,
    book_usfm: str = "JHN",
    start_chapter: int = 3,
    start_verse: int = 16,
    author_id: int = 1,
) -> int:
    async with sessionmaker() as session:
        note = SermonNote(
            title=title,
            sermon_url=sermon_url,
            reference=f"{book_usfm} {start_chapter}:{start_verse}",
            book_usfm=book_usfm,
            book_order_index=book_order_index,
            start_chapter=start_chapter,
            start_verse=start_verse,
            end_chapter=start_chapter,
            end_verse=start_verse,
            event_date=event_date,
            author_id=author_id,
        )
        # Seed it the way an OLD row looks. Since slice 1 the model stamps `youtube_video_id`
        # from `sermon_url` on construction, so a note made today already carries it — but the
        # notes this cleanup exists for were written before that column did, and arrive null.
        # Cleared by assigning the column directly, which is not what the validator watches.
        note.youtube_video_id = None
        session.add(note)
        await session.commit()
        return note.id


async def _row(sessionmaker: async_sessionmaker[AsyncSession], note_id: int) -> SermonNote:
    async with sessionmaker() as session:
        note = await session.get(SermonNote, note_id)
        assert note is not None
        return note


async def _add_other_user(sessionmaker: async_sessionmaker[AsyncSession]) -> None:
    async with sessionmaker() as session:  # user 1 is seeded by the fixture
        session.add(User(id=2, name="someone-else", created_at=datetime.now(UTC)))
        await session.commit()


# ---- The date rule (spec §7) -----------------------------------------------------------------


async def test_a_livestream_is_dated_by_when_the_stream_started(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # The service happened on the Sunday; YouTube published the recording after midnight UTC.
    # `publishedAt` would date this sermon to the Monday, which is the whole reason for the rule.
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    with_youtube(FakeYouTubeClient(videos=[_STREAM_VIDEO]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert item["new_date"] == _STREAM_DAY.isoformat()
    assert item["date_source"] == "stream_start"
    assert item["new_date"] != _STREAM_VIDEO.published_at.date().isoformat()


async def test_a_plain_upload_is_dated_by_when_it_was_published(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _seed(db_sessionmaker, sermon_url=_UPLOAD_URL)
    with_youtube(FakeYouTubeClient(videos=[_UPLOAD_VIDEO]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    item = resp.json()["items"][0]
    assert item["new_date"] == _UPLOAD_DAY.isoformat()
    assert item["date_source"] == "published"


async def test_the_day_is_the_utc_one_not_a_local_one(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # 02:30 UTC is still the previous evening across the Americas. The rule says UTC calendar
    # day, so this must be the 8th — the edge the rule is actually decided at.
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    early = _video(
        _STREAM_ID,
        published_at=datetime(2026, 3, 9, 20, 0, 0, tzinfo=UTC),
        actual_start_time=datetime(2026, 3, 8, 2, 30, 0, tzinfo=UTC),
    )
    with_youtube(FakeYouTubeClient(videos=[early]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.json()["items"][0]["new_date"] == "2026-03-08"


async def test_a_date_that_already_matches_is_reported_unchanged(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL, event_date=_STREAM_DAY)
    with_youtube(FakeYouTubeClient(videos=[_STREAM_VIDEO]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    item = resp.json()["items"][0]
    assert item["changed"] is False
    assert item["current_date"] == item["new_date"]


# ---- What is in scope ------------------------------------------------------------------------


async def test_a_non_youtube_note_is_counted_and_left_alone(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # A sermon hosted anywhere else is perfectly valid — it just isn't ours to re-date.
    other = await _seed(db_sessionmaker, sermon_url=_NOT_YOUTUBE_URL, event_date=date(2020, 1, 1))
    await _seed(db_sessionmaker, sermon_url=_UPLOAD_URL, start_verse=17)
    fake = FakeYouTubeClient(videos=[_UPLOAD_VIDEO])
    with_youtube(fake)
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate?dry_run=false")

    body = resp.json()
    assert body["skipped_non_youtube"] == 1
    assert body["total_youtube_notes"] == 1
    assert [i["id"] for i in body["items"]] != [other]
    # Its id was never even offered to YouTube, and nothing about the row moved.
    assert fake.get_videos_calls == [[_UPLOAD_ID]]
    row = await _row(db_sessionmaker, other)
    assert row.event_date == date(2020, 1, 1)
    assert row.youtube_video_id is None


async def test_a_video_youtube_cannot_find_is_listed_and_still_stamped(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Private or deleted. Its date is unknowable so it is left alone — but the id comes from the
    # URL, not from YouTube, so it is still stamped and a later scan can recognise the video.
    note_id = await _seed(db_sessionmaker, sermon_url=_MISSING_URL, event_date=date(2020, 1, 1))
    with_youtube(FakeYouTubeClient(videos=[]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate?dry_run=false")

    body = resp.json()
    assert body["items"] == []
    assert body["not_found"] == [
        {
            "id": note_id,
            "title": "A sermon",
            "reference": "JHN 3:16",
            "sermon_url": _MISSING_URL,
            "video_id": _MISSING_ID,
        }
    ]
    row = await _row(db_sessionmaker, note_id)
    assert row.event_date == date(2020, 1, 1)  # untouched
    assert row.youtube_video_id == _MISSING_ID  # stamped anyway


async def test_another_authors_notes_are_never_touched(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _add_other_user(db_sessionmaker)
    theirs = await _seed(
        db_sessionmaker, sermon_url=_STREAM_URL, event_date=date(2020, 1, 1), author_id=2
    )
    mine = await _seed(db_sessionmaker, sermon_url=_UPLOAD_URL, start_verse=17)
    fake = FakeYouTubeClient(videos=[_STREAM_VIDEO, _UPLOAD_VIDEO])
    with_youtube(fake)
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate?dry_run=false")

    body = resp.json()
    assert [i["id"] for i in body["items"]] == [mine]
    assert fake.get_videos_calls == [[_UPLOAD_ID]]  # their video was never even looked up
    row = await _row(db_sessionmaker, theirs)
    assert row.event_date == date(2020, 1, 1)
    assert row.youtube_video_id is None


async def test_items_come_back_in_the_sermon_lists_canonical_order(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    """The preview reads in the order the Browse page lists, so the two can be followed together.

    Four notes, because two aren't enough to tell the right answer from the wrong ones: seeded
    in an order that makes id-ascending, id-descending and book-order-alone each produce a
    DIFFERENT sequence from the canonical one. With only two notes, `ORDER BY id DESC` happens
    to give the same answer and the test passes while the ordering is broken.
    """
    ids = ["r0000000000", "g3000000000", "a2000000000", "g1000000000"]
    revelation = await _seed(
        db_sessionmaker,
        sermon_url=f"https://youtu.be/{ids[0]}",
        book_usfm="REV",
        book_order_index=66,
        start_chapter=1,
        start_verse=1,
    )
    genesis_3 = await _seed(
        db_sessionmaker,
        sermon_url=f"https://youtu.be/{ids[1]}",
        book_usfm="GEN",
        book_order_index=1,
        start_chapter=3,
        start_verse=16,
    )
    acts = await _seed(
        db_sessionmaker,
        sermon_url=f"https://youtu.be/{ids[2]}",
        book_usfm="ACT",
        book_order_index=44,
        start_chapter=2,
        start_verse=42,
    )
    genesis_1 = await _seed(
        db_sessionmaker,
        sermon_url=f"https://youtu.be/{ids[3]}",
        book_usfm="GEN",
        book_order_index=1,
        start_chapter=1,
        start_verse=1,
    )
    videos = [_video(v, published_at=datetime(2026, 1, 1, tzinfo=UTC)) for v in ids]
    with_youtube(FakeYouTubeClient(videos=videos))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    seen = [i["id"] for i in resp.json()["items"]]
    assert seen == [genesis_1, genesis_3, acts, revelation]
    # Spelt out so a future reader can see why four: none of the plausible wrong orderings match.
    assert seen != sorted(seen)  # not id-ascending
    assert seen != sorted(seen, reverse=True)  # not id-descending
    assert seen != [genesis_3, genesis_1, acts, revelation]  # not book order alone


# ---- Preview writes nothing; apply writes once -----------------------------------------------


async def test_a_dry_run_writes_nothing_at_all(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Not the date, and not the stamp either — the preview is a gate, not a partial apply.
    stream = await _seed(db_sessionmaker, sermon_url=_STREAM_URL, event_date=date(2020, 1, 1))
    missing = await _seed(db_sessionmaker, sermon_url=_MISSING_URL, start_verse=17)
    with_youtube(FakeYouTubeClient(videos=[_STREAM_VIDEO]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    body = resp.json()
    assert body["dry_run"] is True
    assert body["applied"] == 0
    assert body["items"][0]["changed"] is True  # it WOULD change — it just didn't
    for note_id in (stream, missing):
        row = await _row(db_sessionmaker, note_id)
        assert row.youtube_video_id is None, note_id
    assert (await _row(db_sessionmaker, stream)).event_date == date(2020, 1, 1)


async def test_the_default_is_the_dry_run(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # The safe direction is what you get for asking; writing has to be asked for.
    note_id = await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    with_youtube(FakeYouTubeClient(videos=[_STREAM_VIDEO]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.json()["dry_run"] is True
    assert (await _row(db_sessionmaker, note_id)).event_date is None


async def test_applying_writes_the_dates_and_the_stamps(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    stream = await _seed(db_sessionmaker, sermon_url=_STREAM_URL, event_date=date(2020, 1, 1))
    upload = await _seed(db_sessionmaker, sermon_url=_UPLOAD_URL, start_verse=17)
    with_youtube(FakeYouTubeClient(videos=[_STREAM_VIDEO, _UPLOAD_VIDEO]))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate?dry_run=false")

    body = resp.json()
    assert body["dry_run"] is False
    assert body["applied"] == 2
    stream_row = await _row(db_sessionmaker, stream)
    assert stream_row.event_date == _STREAM_DAY
    assert stream_row.youtube_video_id == _STREAM_ID
    upload_row = await _row(db_sessionmaker, upload)
    assert upload_row.event_date == _UPLOAD_DAY
    assert upload_row.youtube_video_id == _UPLOAD_ID


async def test_applying_twice_changes_nothing_the_second_time(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Re-runnable by design (spec §11), so the button is safe to press twice.
    note_id = await _seed(db_sessionmaker, sermon_url=_STREAM_URL, event_date=date(2020, 1, 1))
    with_youtube(FakeYouTubeClient(videos=[_STREAM_VIDEO]))
    async with client_for(_fake_concord()) as client:
        first = await client.post("/api/v1/sermon-notes/redate?dry_run=false")
        before = await _row(db_sessionmaker, note_id)
        stamped_at = before.updated_at
        second = await client.post("/api/v1/sermon-notes/redate?dry_run=false")

    assert first.json()["applied"] == 1
    assert second.json()["applied"] == 0
    assert all(i["changed"] is False for i in second.json()["items"])
    after = await _row(db_sessionmaker, note_id)
    assert after.event_date == _STREAM_DAY
    # Nothing was written, so `updated_at` did not move — a re-run must not look like an edit.
    assert after.updated_at == stamped_at


async def test_no_youtube_notes_means_no_call_to_youtube(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _seed(db_sessionmaker, sermon_url=_NOT_YOUTUBE_URL)
    fake = FakeYouTubeClient(videos=[])
    with_youtube(fake)
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    body = resp.json()
    assert body == {
        "dry_run": True,
        "total_youtube_notes": 0,
        "items": [],
        "not_found": [],
        "skipped_non_youtube": 1,
        "applied": 0,
    }
    assert fake.get_videos_calls == []  # don't spend a quota unit asking about nothing


# ---- Failure ---------------------------------------------------------------------------------


async def test_without_a_key_it_is_a_409_not_a_500(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # No `with_youtube` here on purpose: nothing overrides the dependency, the lifespan never
    # ran, so this is the real "no key configured" path. A normal state, not a server fault.
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "YOUTUBE_NOT_CONFIGURED"


async def test_an_unreachable_youtube_is_a_502(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    with_youtube(FakeYouTubeClient(error=YouTubeUnreachableError("YouTube is unreachable: nope")))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "YOUTUBE_UNREACHABLE"


async def test_a_spent_quota_is_a_429(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    with_youtube(
        FakeYouTubeClient(error=YouTubeQuotaError("spent", status=403, reason="quotaExceeded"))
    )
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.status_code == 429
    assert resp.json()["detail"]["code"] == "YOUTUBE_QUOTA"


async def test_a_rejected_key_names_the_setting_and_never_the_key(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # This message goes to the browser, so it must tell an admin what to fix and carry no secret.
    await _seed(db_sessionmaker, sermon_url=_STREAM_URL)
    with_youtube(
        FakeYouTubeClient(
            error=YouTubeAuthError(
                "YouTube rejected the API key: 400 (badRequest, API_KEY_INVALID)",
                status=400,
                reason="badRequest",
            )
        )
    )
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate")

    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert detail["code"] == "YOUTUBE_KEY_REJECTED"
    assert "YOUTUBE_API_KEY" in detail["message"]


async def test_a_failed_lookup_writes_nothing(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    with_youtube: Callable[[FakeYouTubeClient], None],
) -> None:
    # Every lookup happens before any write, so a failure part-way leaves the notes as they were
    # rather than half re-dated.
    note_id = await _seed(db_sessionmaker, sermon_url=_STREAM_URL, event_date=date(2020, 1, 1))
    with_youtube(FakeYouTubeClient(error=YouTubeUnreachableError("gone")))
    async with client_for(_fake_concord()) as client:
        resp = await client.post("/api/v1/sermon-notes/redate?dry_run=false")

    assert resp.status_code == 502
    row = await _row(db_sessionmaker, note_id)
    assert row.event_date == date(2020, 1, 1)
    assert row.youtube_video_id is None
