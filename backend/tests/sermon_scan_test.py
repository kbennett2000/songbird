"""The catalogue scan (v1.7 sermon sources, spec §6) — slice 4a's fetch-and-filter half.

Two layers, and the split is the point. The filters are pure functions, so each rule in spec §6 is
one line of test with no database and no HTTP. The runner is driven by `await runner.run()` rather
than by `request_scan()`: the loop is the behaviour, the asyncio task is the plumbing, and awaiting
it means nothing here sleeps or polls.

Synthetic fixtures throughout. The live acceptance against the real churches is in dev-notes.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo, User
from songbird.sermons.scan import (
    STATUS_GONE,
    STATUS_KEY_REJECTED,
    STATUS_OK,
    STATUS_QUOTA,
    STATUS_UNREACHABLE,
    Decision,
    DueSource,
    ScanRunner,
    SourceRule,
    decide,
    paging_mode,
    source_rule,
    status_for,
    stop_here,
)
from songbird.youtube.client import (
    YouTubeAuthError,
    YouTubeNotFoundError,
    YouTubeQuotaError,
    YouTubeUnreachableError,
)
from songbird.youtube.schemas import PlaylistPage, Video
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient, FakeYouTubeClient

_UPLOADS = "UUa1b2c3d4e5f6g7h8i9j0k1"
_CHANNEL_ID = "UCa1b2c3d4e5f6g7h8i9j0k1"
_PLAYLIST_ID = "PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t"
_PUBLISHED = datetime(2026, 1, 5, 14, 0, tzinfo=UTC)

# The app-wide floor every fixture below is built against (SERMON_MIN_MINUTES' default).
_DEFAULT_MIN = 10
_DEFAULT_RULE = SourceRule(min_seconds=_DEFAULT_MIN * 60, include_live=True)


def _video(
    video_id: str,
    *,
    duration: int | None = 3600,
    live: str = "none",
    stream: bool = False,
    published: datetime = _PUBLISHED,
    title: str | None = None,
) -> Video:
    return Video(
        id=video_id,
        title=title or f"Sermon {video_id}",
        description=f"Main Scripture: Acts 7:33-35 ({video_id})",
        published_at=published,
        live_broadcast_content=live,
        duration_seconds=duration,
        actual_start_time=published if stream else None,
        is_livestream=stream,
        channel_id=_CHANNEL_ID,
        channel_title="A Church",
    )


def _ids(n: int, prefix: str = "vid") -> list[str]:
    """`n` well-formed 11-character video ids — the real client drops anything else."""
    return [f"{prefix}{i:08d}"[:11].ljust(11, "x") for i in range(n)]


async def _seed_source(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    source_id: int = 1,
    author_id: int = 1,
    kind: str = "channel",
    youtube_id: str | None = None,
    uploads_playlist_id: str | None = None,
    enabled: bool = True,
    include_live: bool = True,
    min_minutes: int | None = None,
    last_checked_at: datetime | None = None,
    last_check_status: str | None = None,
    check_requested_at: datetime | None = None,
    scan_complete: bool = False,
) -> int:
    async with sessionmaker() as db:
        db.add(
            SermonSource(
                id=source_id,
                kind=kind,
                youtube_id=youtube_id or (_PLAYLIST_ID if kind == "playlist" else _CHANNEL_ID),
                uploads_playlist_id=(
                    None if kind == "playlist" else (uploads_playlist_id or _UPLOADS)
                ),
                input_url="https://www.youtube.com/@achurch",
                title="A Church",
                enabled=enabled,
                include_live=include_live,
                min_minutes=min_minutes,
                last_checked_at=last_checked_at,
                last_check_status=last_check_status,
                check_requested_at=check_requested_at,
                scan_complete=scan_complete,
                author_id=author_id,
            )
        )
        await db.commit()
    return source_id


async def _ledger(
    sessionmaker: async_sessionmaker[AsyncSession], author_id: int = 1
) -> list[SermonSourceVideo]:
    async with sessionmaker() as db:
        rows = (
            await db.execute(
                select(SermonSourceVideo)
                .where(SermonSourceVideo.author_id == author_id)
                .order_by(SermonSourceVideo.id)
            )
        ).scalars()
        return list(rows)


async def _source_row(
    sessionmaker: async_sessionmaker[AsyncSession], source_id: int = 1
) -> SermonSource:
    async with sessionmaker() as db:
        source = await db.get(SermonSource, source_id)
        assert source is not None
        return source


def _runner(
    sessionmaker: async_sessionmaker[AsyncSession],
    youtube: FakeYouTubeClient,
    concord: FakeConcordClient | None = None,
) -> ScanRunner:
    """A runner whose Concord recognises nothing, unless a test says otherwise.

    This file is about FETCHING. Giving it a Concord that refuses every candidate means the
    evaluation that now follows each walk is uniform and uninteresting — every video that survives
    spec §6's filters lands in the review list — so these tests keep asserting what they were
    written to assert. What the passage rules do with a Concord that answers is
    `sermon_place_test.py`.
    """
    return ScanRunner(
        sessionmaker,
        youtube,  # type: ignore[arg-type]
        concord or FakeConcordClient(resolved_by_ref={}),  # type: ignore[arg-type]
        default_min_minutes=_DEFAULT_MIN,
    )


# ---- The filters, spec §6, as pure functions -------------------------------------------------


def test_a_live_or_upcoming_broadcast_is_not_ledgered_at_all() -> None:
    # Filter 1, and the only one that returns None: a row would make an unfinished stream look
    # decided, when the honest answer is "ask again once it has finished".
    for state in ("live", "upcoming"):
        assert decide(_video("a", live=state), _DEFAULT_RULE, already_noted=False) is None, state


def test_a_short_video_is_skipped_with_its_reason() -> None:
    # 9 minutes against a 10-minute floor. This is also the Shorts rule: a Short cannot exceed 3
    # minutes, so the default excludes every one without a separate check.
    assert decide(_video("a", duration=9 * 60), _DEFAULT_RULE, already_noted=False) == Decision(
        "skipped", "too_short"
    )


def test_a_video_of_unknown_length_is_not_a_short_one() -> None:
    """Spec §6.2, and the whole reason `duration_seconds` is nullable.

    A video YouTube withheld a duration for has not earned the `too_short` reason — filing it
    there would be exactly the silent hiding §6 promises not to do. It falls through to the
    passage rules instead. A genuine PT0S is 0, not None, and IS still too short.
    """
    assert decide(_video("a", duration=None), _DEFAULT_RULE, already_noted=False) == Decision(
        "pending", None
    )
    assert decide(_video("a", duration=0), _DEFAULT_RULE, already_noted=False) == Decision(
        "skipped", "too_short"
    )


def test_a_livestream_is_excluded_only_when_the_source_says_so() -> None:
    on = SourceRule(min_seconds=600, include_live=True)
    off = SourceRule(min_seconds=600, include_live=False)
    stream = _video("a", stream=True)
    assert decide(stream, on, already_noted=False) == Decision("pending", None)
    assert decide(stream, off, already_noted=False) == Decision("skipped", "live_excluded")


def test_a_short_livestream_reads_too_short_not_live_excluded() -> None:
    # The order in spec §6 is load-bearing: both filters match, and the reason a person is shown
    # has to be stable rather than depending on which check happened to run first.
    off = SourceRule(min_seconds=600, include_live=False)
    short_stream = _video("a", duration=60, stream=True)
    assert decide(short_stream, off, already_noted=False) == Decision("skipped", "too_short")


def test_a_video_already_noted_by_hand_is_recorded_as_such() -> None:
    assert decide(_video("a"), _DEFAULT_RULE, already_noted=True) == Decision("already_noted", None)


def test_anything_that_survives_every_filter_is_pending() -> None:
    # `pending` is the seam: slice 4a writes it, slice 4b reads it and works out the passage.
    assert decide(_video("a"), _DEFAULT_RULE, already_noted=False) == Decision("pending", None)


def test_a_sources_own_minimum_overrides_the_app_wide_one() -> None:
    # Null means "follow SERMON_MIN_MINUTES", which is why the column is nullable at all.
    follows = source_rule(min_minutes=None, include_live=True, default_min_minutes=10)
    overrides = source_rule(min_minutes=25, include_live=True, default_min_minutes=10)
    assert (follows.min_seconds, overrides.min_seconds) == (600, 1500)


def test_paging_mode_walks_everything_unless_a_channel_finished_last_time() -> None:
    cases: tuple[tuple[str, bool, str], ...] = (
        # A playlist's order is the curator's, so a known page says nothing about the next one.
        ("playlist", True, "full"),
        ("playlist", False, "full"),
        # A channel that finished can trust the stop rule; one that didn't cannot.
        ("channel", True, "incremental"),
        ("channel", False, "full"),
    )
    for kind, complete, expected in cases:
        assert paging_mode(kind=kind, scan_complete=complete) == expected, (kind, complete)


def test_the_stop_rule_only_fires_on_an_all_known_page_of_an_incremental_walk() -> None:
    assert stop_here("incremental", []) is True
    assert stop_here("incremental", ["a"]) is False
    assert stop_here("full", []) is False  # a full walk reads to the end regardless


def test_every_failure_gets_a_sentence_a_person_can_act_on() -> None:
    cases: tuple[tuple[Exception, str], ...] = (
        (YouTubeQuotaError("spent"), STATUS_QUOTA),
        (YouTubeNotFoundError("gone"), STATUS_GONE),
        (YouTubeUnreachableError("down"), STATUS_UNREACHABLE),
    )
    for error, expected in cases:
        assert status_for(error) == expected  # type: ignore[arg-type]
    # A rejected key names the setting and appends Google's token — never the key itself.
    detail = status_for(YouTubeAuthError("no", status=400, reason="API_KEY_INVALID"))
    assert detail.startswith(STATUS_KEY_REJECTED)
    assert "API_KEY_INVALID" in detail
    assert "YOUTUBE_API_KEY" in detail


# ---- The runner: paging, batching, and where a walk stops ------------------------------------


async def test_a_first_check_walks_the_whole_back_catalogue(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Spec §5: adding a source scans everything. A never-checked source has scan_complete False,
    # so `paging_mode` sends it down the full walk without any special case.
    ids = _ids(120)
    pages = [ids[0:50], ids[50:100], ids[100:120]]
    youtube = FakeYouTubeClient(videos=[_video(v) for v in ids], pages={_UPLOADS: pages})
    await _seed_source(db_sessionmaker)

    await _runner(db_sessionmaker, youtube).run()

    assert [row.video_id for row in await _ledger(db_sessionmaker)] == ids
    # Three pages read, and the details fetched 50 at a time — the batching that makes 120 videos
    # cost 3 + 3 quota units rather than 120.
    assert youtube.page_calls == [(_UPLOADS, None), (_UPLOADS, "1"), (_UPLOADS, "2")]
    assert [len(call) for call in youtube.get_videos_calls] == [50, 50, 20]


async def test_a_later_check_stops_at_the_first_page_it_already_knows(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The incremental rule (spec §6): an uploads playlist is newest-first, so a page we have
    entirely seen means everything below it is older still and already ours."""
    ids = _ids(100)
    youtube = FakeYouTubeClient(
        videos=[_video(v) for v in ids], pages={_UPLOADS: [ids[0:50], ids[50:100]]}
    )
    await _seed_source(db_sessionmaker)
    runner = _runner(db_sessionmaker, youtube)
    await runner.run()  # the full first walk

    # Nothing new since; ask again.
    async with db_sessionmaker() as db:
        source = await db.get(SermonSource, 1)
        assert source is not None
        source.check_requested_at = datetime.now(UTC)
        await db.commit()
    youtube.page_calls.clear()
    youtube.get_videos_calls.clear()
    await runner.run()

    # One page, and no detail call at all — the cheapest a check can possibly be.
    assert youtube.page_calls == [(_UPLOADS, None)]
    assert youtube.get_videos_calls == []
    assert len(await _ledger(db_sessionmaker)) == 100


async def test_a_playlist_is_walked_in_full_every_time(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A curated playlist is in the curator's order, not chronological, so a page of known videos
    # says nothing about the next page — the stop rule would silently miss whatever is below it.
    ids = _ids(60)
    youtube = FakeYouTubeClient(
        videos=[_video(v) for v in ids], pages={_PLAYLIST_ID: [ids[0:50], ids[50:60]]}
    )
    await _seed_source(db_sessionmaker, kind="playlist")
    runner = _runner(db_sessionmaker, youtube)
    await runner.run()
    assert len(await _ledger(db_sessionmaker)) == 60

    async with db_sessionmaker() as db:
        source = await db.get(SermonSource, 1)
        assert source is not None
        source.check_requested_at = datetime.now(UTC)
        await db.commit()
    youtube.page_calls.clear()
    await runner.run()

    # Both pages again, even though every video on both is already known.
    assert youtube.page_calls == [(_PLAYLIST_ID, None), (_PLAYLIST_ID, "1")]


async def test_a_channel_whose_last_check_died_walks_everything_again(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The hole the `scan_complete` column exists to close.

    A check that committed page one and then failed leaves page one entirely known. Under a rule
    that keyed only on "has it ever been checked", every future check would stop at that page and
    the rest of the catalogue would be unreachable — permanently, with no error anywhere.
    """
    ids = _ids(100)
    youtube = FakeYouTubeClient(
        videos=[_video(v) for v in ids], pages={_UPLOADS: [ids[0:50], ids[50:100]]}
    )
    # Page one is already ledgered, and the source has been checked — but that check did NOT
    # finish, which is exactly the state a failed scan leaves behind.
    await _seed_source(
        db_sessionmaker,
        last_checked_at=datetime(2026, 1, 1, tzinfo=UTC),
        last_check_status=STATUS_UNREACHABLE,
        scan_complete=False,
        check_requested_at=datetime.now(UTC),
    )
    async with db_sessionmaker() as db:
        for video_id in ids[0:50]:
            db.add(
                SermonSourceVideo(
                    source_id=1,
                    author_id=1,
                    video_id=video_id,
                    title="seen",
                    description="",
                    published_at=_PUBLISHED,
                    duration_seconds=3600,
                    status="pending",
                    seen_at=datetime.now(UTC),
                )
            )
        await db.commit()

    await _runner(db_sessionmaker, youtube).run()

    # It read past the all-known first page and picked up the fifty nobody would ever have seen.
    assert youtube.page_calls == [(_UPLOADS, None), (_UPLOADS, "1")]
    assert len(await _ledger(db_sessionmaker)) == 100
    assert (await _source_row(db_sessionmaker)).scan_complete is True


async def test_each_filter_lands_the_right_row(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ids = _ids(5)
    keep, short, stream, noted, upcoming = ids
    youtube = FakeYouTubeClient(
        videos=[
            _video(keep),
            _video(short, duration=60),
            _video(stream, stream=True),
            _video(noted),
            _video(upcoming, live="upcoming"),
        ],
        pages={_UPLOADS: [ids]},
    )
    await _seed_source(db_sessionmaker, include_live=False)
    async with db_sessionmaker() as db:
        db.add(
            SermonNote(
                title="Written by hand",
                sermon_url=f"https://www.youtube.com/watch?v={noted}",
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
        await db.commit()

    await _runner(db_sessionmaker, youtube).run()

    rows = {row.video_id: row for row in await _ledger(db_sessionmaker)}
    # Fetched, filtered, and then read: this Concord recognises nothing, so the one video that
    # survived §6's filters has no passage anyone could place and lands in the review list. What
    # it takes to reach `placed` is `sermon_place_test.py`.
    assert (rows[keep].status, rows[keep].skip_reason) == ("needs_passage", None)
    assert (rows[short].status, rows[short].skip_reason) == ("skipped", "too_short")
    assert (rows[stream].status, rows[stream].skip_reason) == ("skipped", "live_excluded")
    assert (rows[noted].status, rows[noted].skip_reason) == ("already_noted", None)
    # The one that gets no row at all — it has not happened yet, so there is nothing to decide.
    assert upcoming not in rows
    # Every row that has stopped being `pending` is dated, and by the end of a check none of them
    # is still pending: the walk writes the skips, and the reading that follows decides the rest.
    assert all(row.decided_at is not None for row in rows.values())


async def test_a_broadcast_is_picked_up_once_it_has_finished(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The other half of filter 1: leaving no trace is only right because the next check sees it.
    [video_id] = _ids(1)
    youtube = FakeYouTubeClient(
        videos=[_video(video_id, live="live")], pages={_UPLOADS: [[video_id]]}
    )
    await _seed_source(db_sessionmaker)
    runner = _runner(db_sessionmaker, youtube)
    await runner.run()
    assert await _ledger(db_sessionmaker) == []

    # The stream ends: YouTube now calls it "none" and gives it a real duration.
    youtube._videos = [_video(video_id, live="none", stream=True, duration=4200)]  # noqa: SLF001
    async with db_sessionmaker() as db:
        source = await db.get(SermonSource, 1)
        assert source is not None
        source.check_requested_at = datetime.now(UTC)
        await db.commit()
    await runner.run()

    rows = await _ledger(db_sessionmaker)
    assert [(r.video_id, r.status, r.is_live) for r in rows] == [
        (video_id, "needs_passage", True)
    ]


async def test_another_users_note_does_not_make_this_video_look_handled(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # `already_noted` is scoped to the source's author. Two people following the same church must
    # each get their own ledger row and their own note.
    [video_id] = _ids(1)
    youtube = FakeYouTubeClient(videos=[_video(video_id)], pages={_UPLOADS: [[video_id]]})
    async with db_sessionmaker() as db:
        db.add(User(id=2, name="someone-else"))
        await db.commit()
    await _seed_source(db_sessionmaker, author_id=1)
    async with db_sessionmaker() as db:
        db.add(
            SermonNote(
                title="Their note, not ours",
                sermon_url=f"https://www.youtube.com/watch?v={video_id}",
                reference="JHN 3:16",
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

    await _runner(db_sessionmaker, youtube).run()

    rows = await _ledger(db_sessionmaker, author_id=1)
    # Not `already_noted`: the other user's note is theirs. It gets read for a passage like any
    # other unseen video.
    assert [(r.video_id, r.status) for r in rows] == [(video_id, "needs_passage")]


async def test_a_source_with_its_own_minimum_uses_it(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    ids = _ids(2)
    fifteen, thirty = ids
    youtube = FakeYouTubeClient(
        videos=[_video(fifteen, duration=15 * 60), _video(thirty, duration=30 * 60)],
        pages={_UPLOADS: [ids]},
    )
    # 25 minutes, well above the app-wide 10 — so the 15-minute video is short HERE and would not
    # have been anywhere else.
    await _seed_source(db_sessionmaker, min_minutes=25)

    await _runner(db_sessionmaker, youtube).run()

    rows = {row.video_id: row.status for row in await _ledger(db_sessionmaker)}
    assert rows == {fifteen: "skipped", thirty: "needs_passage"}


async def test_a_video_one_source_already_ledgered_is_not_ledgered_twice(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """One row per video per author, whichever source saw it first (spec §4's uniqueness).

    A church's curated playlist repeats its own uploads, so without this the same sermon would be
    ledgered twice and later noted twice.
    """
    ids = _ids(3)
    youtube = FakeYouTubeClient(
        videos=[_video(v) for v in ids],
        pages={_UPLOADS: [ids[0:2]], _PLAYLIST_ID: [ids]},  # the playlist repeats both uploads
    )
    await _seed_source(db_sessionmaker, source_id=1, kind="channel")
    await _seed_source(db_sessionmaker, source_id=2, kind="playlist")

    await _runner(db_sessionmaker, youtube).run()

    rows = await _ledger(db_sessionmaker)
    assert [r.video_id for r in rows] == ids
    # The channel was checked first, so it owns the two it saw; only the third is the playlist's.
    assert [r.source_id for r in rows] == [1, 1, 2]


# ---- Failure, bookkeeping, and the one background task ---------------------------------------


async def test_a_failure_part_way_through_keeps_what_was_already_committed(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The ledger is the checkpoint (spec §6): batches commit as they go.

    Fifty videos is one quota unit and about a second of work, so that is what a failure costs —
    not the whole catalogue, and not a re-run that has to start from nothing.
    """
    ids = _ids(120)
    youtube = FakeYouTubeClient(
        videos=[_video(v) for v in ids],
        pages={_UPLOADS: [ids[0:50], ids[50:100], ids[100:120]]},
        error=YouTubeUnreachableError("YouTube is unreachable"),
        error_after_pages=1,  # the first detail batch lands; the second raises
    )
    await _seed_source(db_sessionmaker)

    await _runner(db_sessionmaker, youtube).run()

    assert [row.video_id for row in await _ledger(db_sessionmaker)] == ids[0:50]
    source = await _source_row(db_sessionmaker)
    assert source.last_check_status == STATUS_UNREACHABLE
    assert source.last_checked_at is not None
    # It got part way, so the next check must not trust the stop rule — the premise it rests on
    # (every page above the stop is complete) is exactly what just stopped being true.
    assert source.scan_complete is False


async def test_a_failure_before_any_page_leaves_the_paging_mode_alone(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # An unreachable YouTube fails on the very first call, having changed nothing. Marking the
    # catalogue incomplete for that would make every transient blip cost a full re-walk of every
    # source — an expensive way to record that nothing happened.
    youtube = FakeYouTubeClient(page_error=YouTubeUnreachableError("down"))
    await _seed_source(
        db_sessionmaker,
        last_checked_at=datetime(2026, 1, 1, tzinfo=UTC),
        last_check_status=STATUS_OK,
        scan_complete=True,
        check_requested_at=datetime.now(UTC),
    )

    await _runner(db_sessionmaker, youtube).run()

    source = await _source_row(db_sessionmaker)
    assert source.last_check_status == STATUS_UNREACHABLE
    assert source.scan_complete is True  # untouched


async def test_one_sources_failure_does_not_stop_the_next(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Spec §6: a YouTube error is recorded on the affected source; the run carries on. A shared
    # session would make this impossible — the failed flush would refuse every later statement.
    ids = _ids(2)
    youtube = FakeYouTubeClient(
        videos=[_video(v) for v in ids],
        pages={_PLAYLIST_ID: [ids]},  # the channel's uploads list is absent → nothing to read
    )
    await _seed_source(db_sessionmaker, source_id=1, kind="channel")
    await _seed_source(db_sessionmaker, source_id=2, kind="playlist")

    await _runner(db_sessionmaker, youtube).run()

    assert len(await _ledger(db_sessionmaker)) == 2
    assert (await _source_row(db_sessionmaker, 2)).last_check_status == STATUS_OK


async def test_running_out_of_quota_stops_the_whole_run(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Spec §6: quota is not one source's fault and retrying anything today is wasted, so the run
    # ends rather than spending the same failure on every remaining source.
    youtube = FakeYouTubeClient(page_error=YouTubeQuotaError("spent", status=403))
    await _seed_source(db_sessionmaker, source_id=1)
    await _seed_source(
        db_sessionmaker,
        source_id=2,
        youtube_id="UCzzzzzzzzzzzzzzzzzzzzzz",
        uploads_playlist_id="UUzzzzzzzzzzzzzzzzzzzzzz",
    )

    await _runner(db_sessionmaker, youtube).run()

    assert (await _source_row(db_sessionmaker, 1)).last_check_status == STATUS_QUOTA
    # The second was never touched, so it stays due and is picked up when the quota resets.
    second = await _source_row(db_sessionmaker, 2)
    assert second.last_check_status is None
    assert second.last_checked_at is None
    assert youtube.page_calls == [(_UPLOADS, None)]


async def test_a_check_records_when_it_ran_and_clears_the_request(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    youtube = FakeYouTubeClient(pages={_UPLOADS: [[]]})
    await _seed_source(db_sessionmaker, check_requested_at=datetime.now(UTC))

    await _runner(db_sessionmaker, youtube).run()

    source = await _source_row(db_sessionmaker)
    assert source.check_requested_at is None  # the request has been served
    assert source.last_checked_at is not None
    assert source.last_check_status == STATUS_OK
    assert source.scan_complete is True


async def test_a_paused_source_is_never_checked(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Pausing a source is how you stop it costing quota, so it must not be due even if something
    # managed to leave a request on it.
    youtube = FakeYouTubeClient(pages={_UPLOADS: [_ids(3)]})
    await _seed_source(db_sessionmaker, enabled=False, check_requested_at=datetime.now(UTC))

    await _runner(db_sessionmaker, youtube).run()

    assert youtube.page_calls == []
    assert await _ledger(db_sessionmaker) == []


async def test_a_check_asked_for_mid_scan_is_not_swallowed_by_the_clear(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The conditional clear, and the bug it prevents.

    A full back-catalogue scan runs for minutes. Someone gets impatient and presses Check now
    while it is running: that request arrives with a timestamp LATER than the one this check
    started with, so clearing unconditionally would drop it — no error, no retry, a button that
    visibly did nothing.
    """
    ids = _ids(2)
    sessionmaker = db_sessionmaker

    class StampsMidScan(FakeYouTubeClient):
        """Presses "Check now" from inside the walk, exactly once."""

        stamped = False

        async def list_playlist_page(
            self, playlist_id: str, page_token: str | None = None
        ) -> PlaylistPage:
            if not StampsMidScan.stamped:
                StampsMidScan.stamped = True
                async with sessionmaker() as db:
                    source = await db.get(SermonSource, 1)
                    assert source is not None
                    source.check_requested_at = datetime.now(UTC) + timedelta(minutes=5)
                    await db.commit()
            return await super().list_playlist_page(playlist_id, page_token)

    youtube = StampsMidScan(videos=[_video(v) for v in ids], pages={_UPLOADS: [ids]})
    await _seed_source(db_sessionmaker, check_requested_at=datetime.now(UTC))

    await _runner(db_sessionmaker, youtube).run()

    # The run picked the surviving request up on its next pass and checked the source AGAIN,
    # rather than letting the press vanish. That second check is the whole behaviour.
    #
    # The request is still standing afterwards, and that is correct rather than a leak: this test
    # stamps five minutes ahead so the window is deterministic, and a request dated in the future
    # is not one any check has served yet. A real press lands milliseconds later and is cleared by
    # the very next pass — which the unit test below pins exactly.
    assert len(youtube.page_calls) == 2
    assert (await _source_row(db_sessionmaker)).check_requested_at is not None


async def test_the_clear_serves_every_request_made_before_the_check_started(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The two halves of the conditional clear, pinned exactly.

    Driven directly rather than through a scan because the window is microseconds wide in a real
    run: what matters is the comparison, not the timing that produces it.
    """
    youtube = FakeYouTubeClient()
    runner = _runner(db_sessionmaker, youtube)
    started = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)

    # A request made WHILE this check was running: later than the check's own start, so it has
    # not been served and must survive.
    await _seed_source(db_sessionmaker, check_requested_at=started + timedelta(minutes=1))
    await runner._record_check(DueSource(1, None), started, STATUS_OK, True)  # noqa: SLF001
    source = await _source_row(db_sessionmaker)
    assert source.check_requested_at is not None
    # …and the rest of the outcome is recorded either way, so the source is not stuck.
    assert source.last_checked_at is not None
    assert source.last_check_status == STATUS_OK

    # A request made BEFORE it started is exactly what this check just answered, so it goes.
    async with db_sessionmaker() as db:
        row = await db.get(SermonSource, 1)
        assert row is not None
        row.check_requested_at = started - timedelta(minutes=1)
        await db.commit()
    await runner._record_check(DueSource(1, None), started, STATUS_OK, True)  # noqa: SLF001
    assert (await _source_row(db_sessionmaker)).check_requested_at is None


async def test_a_source_whose_result_cannot_be_written_is_not_scanned_forever(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The liveness guard.

    Because each pass re-queries, a source whose outcome we failed to record stays due — and
    would be scanned again, and again, spending YouTube quota against a database that is not
    answering. It is skipped for the rest of the run instead.
    """
    youtube = FakeYouTubeClient(pages={_UPLOADS: [_ids(1)]}, videos=[_video(_ids(1)[0])])
    await _seed_source(db_sessionmaker, check_requested_at=datetime.now(UTC))
    runner = _runner(db_sessionmaker, youtube)

    async def _cannot_record(
        due: DueSource, started_at: datetime, status: str, complete: bool | None
    ) -> None:
        return None  # the write silently does nothing, as a failed one would

    runner._record_check = _cannot_record  # type: ignore[method-assign]  # noqa: SLF001
    await runner.run()

    # Once, not forever.
    assert youtube.page_calls == [(_UPLOADS, None)]


async def test_two_requests_do_not_start_two_scans(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The "at most one" guarantee. `request_scan` holds no await, so nothing can run between its
    # done() check and its create_task — two callers cannot both find no task and both make one.
    youtube = FakeYouTubeClient(pages={_UPLOADS: [[]]})
    await _seed_source(db_sessionmaker, check_requested_at=datetime.now(UTC))
    runner = _runner(db_sessionmaker, youtube)

    runner.request_scan()
    first = runner._task  # noqa: SLF001
    runner.request_scan()
    assert runner._task is first  # noqa: SLF001
    assert runner.running is True
    # Set before the task ran, so the page's very next /status sees it (that is what starts the
    # poll; a flag set inside the task could lose that race).
    assert runner.started_at is not None

    assert first is not None
    await first
    assert runner.running is False


async def test_shutdown_stops_a_scan_without_recording_a_check_that_did_not_happen(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """A cancelled scan leaves the row alone on purpose.

    Writing `last_checked_at` would clear the source's dueness and hide a check that never
    finished; leaving it means the next boot finds it still due.
    """
    started = asyncio.Event()

    class NeverFinishes(FakeYouTubeClient):
        async def list_playlist_page(
            self, playlist_id: str, page_token: str | None = None
        ) -> PlaylistPage:
            started.set()
            await asyncio.sleep(3600)
            raise AssertionError("unreachable")

    await _seed_source(db_sessionmaker, check_requested_at=datetime.now(UTC))
    runner = _runner(db_sessionmaker, NeverFinishes())

    runner.request_scan()
    await started.wait()
    await runner.aclose()

    assert runner.running is False
    source = await _source_row(db_sessionmaker)
    assert source.last_checked_at is None
    assert source.check_requested_at is not None  # still due, as it should be

    # And a request arriving during shutdown starts nothing.
    runner.request_scan()
    assert runner.running is False


async def test_a_naive_timestamp_from_sqlite_still_compares_correctly(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """SQLite hands back `DateTime(timezone=True)` columns as NAIVE datetimes.

    Every comparison the runner makes on them therefore happens in SQL, where SQLAlchemy binds an
    aware value as its naive UTC wall clock. Doing it in Python instead would be a TypeError the
    moment a source had ever been checked — which is to say, in production and never in a test
    that forgot to seed the column.
    """
    youtube = FakeYouTubeClient(pages={_UPLOADS: [[]]})
    requested = datetime.now(UTC)
    await _seed_source(db_sessionmaker, check_requested_at=requested)

    stored = (await _source_row(db_sessionmaker)).check_requested_at
    assert stored is not None
    assert stored.tzinfo is None  # the shape that would break a Python-side comparison

    await _runner(db_sessionmaker, youtube).run()
    assert (await _source_row(db_sessionmaker)).check_requested_at is None


async def test_another_users_ledger_row_does_not_hide_the_video_from_this_one(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """ "Have I seen this?" is asked per author, not globally.

    Two people can follow the same church, and each needs their own ledger row — the uniqueness
    is on (author_id, video_id) precisely so that they can. A membership check that forgot the
    author would make the second person's catalogue look entirely already-seen.
    """
    [video_id] = _ids(1)
    youtube = FakeYouTubeClient(videos=[_video(video_id)], pages={_UPLOADS: [[video_id]]})
    async with db_sessionmaker() as db:
        db.add(User(id=2, name="someone-else"))
        await db.commit()
    # Someone else already has this exact video in their ledger, from their own source.
    await _seed_source(
        db_sessionmaker,
        source_id=2,
        author_id=2,
        youtube_id="UCzzzzzzzzzzzzzzzzzzzzzz",
        uploads_playlist_id="UUzzzzzzzzzzzzzzzzzzzzzz",
        last_checked_at=datetime(2026, 1, 1, tzinfo=UTC),
        last_check_status=STATUS_OK,
        scan_complete=True,
    )
    async with db_sessionmaker() as db:
        db.add(
            SermonSourceVideo(
                source_id=2,
                author_id=2,
                video_id=video_id,
                title="Theirs",
                description="",
                published_at=_PUBLISHED,
                duration_seconds=3600,
                status="pending",
                seen_at=datetime.now(UTC),
            )
        )
        await db.commit()
    await _seed_source(db_sessionmaker, source_id=1, author_id=1)

    await _runner(db_sessionmaker, youtube).run()

    assert [r.video_id for r in await _ledger(db_sessionmaker, author_id=1)] == [video_id]


async def test_only_enabled_sources_are_ever_due(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The due query itself, driven directly.

    `_scan_source` re-checks `enabled` as well, because a source can be paused between the query
    and the scan — but that second guard hides this one from the loop, so the filter that decides
    what a check even costs is tested where it lives.
    """
    runner = _runner(db_sessionmaker, FakeYouTubeClient())
    checked = datetime(2026, 1, 1, tzinfo=UTC)
    # Never checked → due. Asked for → due. Paused → never, whichever of those is also true.
    await _seed_source(db_sessionmaker, source_id=1, youtube_id="UC00000000000000000000a1")
    await _seed_source(
        db_sessionmaker,
        source_id=2,
        youtube_id="UC00000000000000000000a2",
        last_checked_at=checked,
        check_requested_at=datetime.now(UTC),
    )
    await _seed_source(
        db_sessionmaker,
        source_id=3,
        youtube_id="UC00000000000000000000a3",
        enabled=False,
        check_requested_at=datetime.now(UTC),
    )
    # Checked already, and nobody has asked again — the steady state, and not due.
    await _seed_source(
        db_sessionmaker,
        source_id=4,
        youtube_id="UC00000000000000000000a4",
        last_checked_at=checked,
        last_check_status=STATUS_OK,
        scan_complete=True,
    )

    assert sorted(d.id for d in await runner._due_sources()) == [1, 2]  # noqa: SLF001


async def test_a_video_that_appears_on_two_pages_is_ledgered_once(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """YouTube pages over a list that shifts while you walk it.

    A video posted mid-scan pushes everything down a slot, so an id already read on page one can
    arrive again on page two. Ledgering it twice is an IntegrityError on (author_id, video_id)
    that would abort the batch and lose the whole page with it — so this is a correctness guard,
    not a tidiness one. Pages here are small on purpose: nothing has been committed yet when the
    repeat arrives, so the database cannot be what catches it.
    """
    a, b, c = _ids(3)
    youtube = FakeYouTubeClient(
        videos=[_video(a), _video(b), _video(c)],
        pages={_UPLOADS: [[a, b], [b, c]]},  # b slides onto the second page
    )
    await _seed_source(db_sessionmaker)

    await _runner(db_sessionmaker, youtube).run()

    assert [row.video_id for row in await _ledger(db_sessionmaker)] == [a, b, c]


async def test_a_scan_killed_after_a_batch_leaves_the_catalogue_marked_incomplete(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """Why `scan_complete` goes False with the first batch's commit rather than in a `finally`.

    A container restart, a power cut, a kill -9 — none of them reach the code that records a
    check's outcome. Writing the flag as part of a commit that was happening anyway is what makes
    those cases safe: the next check sees an unfinished catalogue and walks the whole thing,
    rather than trusting a stop rule whose premise died with the process.
    """
    # A full batch on the first page, because unseen ids buffer ACROSS pages: fewer than fifty
    # and nothing commits until the walk ends. That pairing is the point — the flag goes False in
    # the same commit as the rows, so a scan killed before either wrote anything leaves no hole
    # to mark and no flag to clear.
    ids = _ids(51)
    committed = asyncio.Event()

    class DiesAfterTheFirstBatch(FakeYouTubeClient):
        async def list_playlist_page(
            self, playlist_id: str, page_token: str | None = None
        ) -> PlaylistPage:
            if page_token is not None:
                committed.set()  # the first page's batch is on disk by now
                await asyncio.sleep(3600)  # …and then the process goes away
            return await super().list_playlist_page(playlist_id, page_token)

    youtube = DiesAfterTheFirstBatch(
        videos=[_video(v) for v in ids], pages={_UPLOADS: [ids[0:50], ids[50:51]]}
    )
    # A source whose last check DID finish, so False here can only have come from this scan.
    await _seed_source(
        db_sessionmaker,
        last_checked_at=datetime(2026, 1, 1, tzinfo=UTC),
        last_check_status=STATUS_OK,
        scan_complete=True,
        check_requested_at=datetime.now(UTC),
    )
    runner = _runner(db_sessionmaker, youtube)

    runner.request_scan()
    await committed.wait()
    await runner.aclose()  # nothing records an outcome down this path

    # The fifty are on disk…
    assert len(await _ledger(db_sessionmaker)) == 50
    source = await _source_row(db_sessionmaker)
    # …so the catalogue is known to be incomplete, and the next check will walk all of it.
    assert source.scan_complete is False
    # And the outcome really was never recorded — nothing down this path reaches the recorder,
    # which is exactly why the flag cannot be written there.
    assert source.last_check_status == STATUS_OK
    assert source.last_checked_at == datetime(2026, 1, 1)


async def test_a_streams_own_start_time_is_kept_beside_its_publish_date(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The two timestamps disagree, and the ledger has to carry both (spec §7).

    A Sunday service streamed at 14:55 UTC is routinely published at 04:32 the NEXT morning, so
    `published_at` alone files a Sunday sermon under Monday — which is what a reader compares
    against the church's own page and finds wrong. Confirmed live: this is the shape of nearly
    every row Majestic View produces.
    """
    streamed, uploaded = _ids(2)
    started = datetime(2026, 9, 6, 14, 55, 12, tzinfo=UTC)
    published_next_day = datetime(2026, 9, 7, 4, 32, 29, tzinfo=UTC)
    youtube = FakeYouTubeClient(
        videos=[
            _video(streamed, stream=True, published=published_next_day),
            _video(uploaded, published=published_next_day),
        ],
        pages={_UPLOADS: [[streamed, uploaded]]},
    )
    # `_video` derives actual_start_time from `published`, so set the stream's start explicitly.
    youtube._videos[0] = _video(  # noqa: SLF001
        streamed, stream=True, published=published_next_day
    ).model_copy(update={"actual_start_time": started})
    await _seed_source(db_sessionmaker)

    await _runner(db_sessionmaker, youtube).run()

    rows = {row.video_id: row for row in await _ledger(db_sessionmaker)}
    # Compared without a timezone because SQLite hands these back naive — the same trap the
    # runner's own comparisons avoid by staying in SQL.
    assert rows[streamed].actual_start_time == started.replace(tzinfo=None)
    assert rows[streamed].published_at == published_next_day.replace(tzinfo=None)
    # The pair is the point: the stream STARTED on the Sunday and was PUBLISHED on the Monday, so
    # a ledger carrying only the second would show the wrong day for the service.
    assert rows[streamed].actual_start_time.date() != rows[streamed].published_at.date()
    # An ordinary upload has no start time, so the publish date is all there is — and is right.
    assert rows[uploaded].actual_start_time is None
