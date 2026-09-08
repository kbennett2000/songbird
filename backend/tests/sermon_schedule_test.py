"""The scheduled check (v1.7 sermon sources, spec §6c) — slice 6's timer.

Two layers, the same split `sermon_scan_test.py` uses. `is_due` is pure, so every rule about when
a source has gone too long is one line of test with no clock and no database — which matters here
more than anywhere, because this suite fakes time nowhere and should not start.

The timer itself is driven by awaiting `fire()` and `catch_up()` directly. `start()` is the
plumbing and is tested only for the two things that are its own behaviour: that an interval of 0
creates nothing, and that shutting down is safe whether or not anything was ever started.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from songbird.db.models import SermonSource, User
from songbird.sermons.scan import ScanRunner
from songbird.sermons.schedule import ScheduledCheck, is_due
from songbird.youtube.schemas import PlaylistPage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient, FakeYouTubeClient

_INTERVAL = 168  # the shipped default: weekly
_NOW = datetime(2026, 9, 7, 3, 2, tzinfo=UTC)


async def _seed(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    source_id: int = 1,
    author_id: int = 1,
    enabled: bool = True,
    last_checked_at: datetime | None = None,
) -> int:
    async with sessionmaker() as db:
        if author_id != 1 and await db.get(User, author_id) is None:
            db.add(User(id=author_id, name=f"user{author_id}", username=f"user{author_id}"))
        db.add(
            SermonSource(
                id=source_id,
                kind="channel",
                youtube_id=f"UC{source_id:022d}",
                uploads_playlist_id=f"UU{source_id:022d}",
                input_url="https://www.youtube.com/@achurch",
                title=f"Church {source_id}",
                enabled=enabled,
                last_checked_at=last_checked_at,
                author_id=author_id,
            )
        )
        await db.commit()
    return source_id


async def _requested(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> dict[int, datetime | None]:
    async with sessionmaker() as db:
        rows = (await db.execute(select(SermonSource.id, SermonSource.check_requested_at))).all()
    return {row[0]: row[1] for row in rows}


def _runner(sessionmaker: async_sessionmaker[AsyncSession]) -> ScanRunner:
    return ScanRunner(
        sessionmaker,
        FakeYouTubeClient(),  # type: ignore[arg-type]
        FakeConcordClient(resolved_by_ref={}),  # type: ignore[arg-type]
        default_min_minutes=10,
    )


def _timer(
    sessionmaker: async_sessionmaker[AsyncSession],
    runner: ScanRunner | None = None,
    *,
    interval_hours: int = _INTERVAL,
) -> ScheduledCheck:
    return ScheduledCheck(
        sessionmaker, runner or _runner(sessionmaker), interval_hours=interval_hours
    )


# ---- Dueness, as a pure function --------------------------------------------------------------


def test_a_source_checked_longer_ago_than_the_interval_is_due() -> None:
    for hours_ago in (_INTERVAL, _INTERVAL + 1, _INTERVAL * 2, _INTERVAL * 24):
        checked = _NOW - timedelta(hours=hours_ago)
        assert is_due(checked, _NOW, _INTERVAL) is True, hours_ago


def test_a_source_checked_within_the_interval_is_not_due() -> None:
    # The boundary matters: this is what stops a restart being a free full check of every
    # catalogue, which is the whole reason boot catch-up asks rather than just firing.
    for hours_ago in (0, 1, _INTERVAL - 1):
        checked = _NOW - timedelta(hours=hours_ago)
        assert is_due(checked, _NOW, _INTERVAL) is False, hours_ago


def test_a_source_that_was_never_checked_is_due() -> None:
    # A source added while songbird was stopped still has to get its first catalogue scan (§5).
    assert is_due(None, _NOW, _INTERVAL) is True


def test_a_naive_timestamp_is_read_as_utc_rather_than_raising() -> None:
    """SQLite hands `DateTime(timezone=True)` back without its offset.

    Comparing that value straight against an aware `datetime.now(UTC)` is a `TypeError` — the trap
    `DueSource.requested_at` documents. A naive value means UTC here, because every writer in
    songbird stores `datetime.now(UTC)`, so the two readings must agree.
    """
    aware = _NOW - timedelta(hours=_INTERVAL + 1)
    naive = aware.replace(tzinfo=None)

    assert is_due(naive, _NOW, _INTERVAL) is True
    assert is_due(naive, _NOW, _INTERVAL) == is_due(aware, _NOW, _INTERVAL)
    # And the same agreement on the other side of the boundary, so the fix is not "always true".
    recent = _NOW - timedelta(hours=1)
    assert is_due(recent.replace(tzinfo=None), _NOW, _INTERVAL) is False


# ---- One scheduled run ------------------------------------------------------------------------


async def test_a_scheduled_run_asks_for_every_enabled_source_and_no_disabled_one(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Global, not author-scoped: this is the box's schedule, not one person's. A disabled source
    # is left alone, because switching one off is how you stop it costing quota (§6).
    await _seed(db_sessionmaker, source_id=1, author_id=1)
    await _seed(db_sessionmaker, source_id=2, author_id=2)
    await _seed(db_sessionmaker, source_id=3, author_id=1, enabled=False)

    queued = await _timer(db_sessionmaker).fire()

    assert queued == 2
    requested = await _requested(db_sessionmaker)
    assert requested[1] is not None
    assert requested[2] is not None
    assert requested[3] is None


async def test_a_scheduled_run_stamps_the_row_before_it_tells_the_runner(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The durable half of a check has to be committed, not just remembered.

    `check_requested_at` on the row is what survives a crash between the timer deciding and the
    scan happening — the same two-step every "Check now" endpoint does.
    """
    await _seed(db_sessionmaker)
    runner = _runner(db_sessionmaker)
    timer = _timer(db_sessionmaker, runner)

    await timer.fire()
    try:
        assert (await _requested(db_sessionmaker))[1] is not None
        assert runner.running is True
        assert timer.last_run_at is not None
    finally:
        await runner.aclose()


async def test_the_timer_never_starts_a_second_scan(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The timer creates no task of its own.

    `request_scan` is the single guard against two scans running at once, and its guarantee is
    that it contains no `await`. A timer that made its own task would walk straight around it.

    The scan is parked rather than left to finish, because `fire()` awaits the database: a scan
    allowed to complete in that window would leave `_task.done()`, the second `request_scan` would
    legitimately start a fresh one, and this test would pass or fail on timing instead of on the
    thing it is about.
    """
    started = asyncio.Event()

    class NeverFinishes(FakeYouTubeClient):
        async def list_playlist_page(
            self, playlist_id: str, page_token: str | None = None
        ) -> PlaylistPage:
            started.set()
            await asyncio.sleep(3600)
            raise AssertionError("unreachable")

    await _seed(db_sessionmaker)
    runner = ScanRunner(
        db_sessionmaker,
        NeverFinishes(),  # type: ignore[arg-type]
        FakeConcordClient(resolved_by_ref={}),  # type: ignore[arg-type]
        default_min_minutes=10,
    )
    timer = _timer(db_sessionmaker, runner)

    await timer.fire()
    await started.wait()
    first = runner._task  # noqa: SLF001
    await timer.fire()
    try:
        assert runner._task is first  # noqa: SLF001
        assert runner.running is True
    finally:
        await runner.aclose()


# ---- Boot catch-up ----------------------------------------------------------------------------


async def test_boot_catches_up_a_source_that_went_unchecked_while_the_box_was_off(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The point of catch-up: a box rebooted more often than the interval would otherwise never
    # run a scheduled check at all.
    await _seed(db_sessionmaker, last_checked_at=datetime.now(UTC) - timedelta(hours=_INTERVAL + 1))
    runner = _runner(db_sessionmaker)

    fired = await _timer(db_sessionmaker, runner).catch_up()

    try:
        assert fired is True
        assert (await _requested(db_sessionmaker))[1] is not None
    finally:
        await runner.aclose()


async def test_boot_leaves_a_recently_checked_source_alone(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A restart is not a free full check. Without this, a box that restarts often would re-walk
    # every catalogue every time it came up.
    await _seed(db_sessionmaker, last_checked_at=datetime.now(UTC) - timedelta(hours=1))

    fired = await _timer(db_sessionmaker).catch_up()

    assert fired is False
    assert (await _requested(db_sessionmaker))[1] is None


async def test_boot_catch_up_ignores_a_disabled_source_however_stale(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # A source switched off years ago must not drag the whole box into a scan at every boot.
    await _seed(db_sessionmaker, enabled=False, last_checked_at=None)

    assert await _timer(db_sessionmaker).catch_up() is False
    assert (await _requested(db_sessionmaker))[1] is None


# ---- Starting and stopping --------------------------------------------------------------------


async def test_an_interval_of_zero_starts_no_timer_at_all(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """`0` is off, and off means no task — spec §3.

    A task that wakes up and declines to do anything would be off in a branch only. This way it
    is off in a stack dump too, and `timer_enabled` on `/status` has something true to report.
    """
    await _seed(db_sessionmaker, last_checked_at=None)  # due, so only the interval stops it
    timer = _timer(db_sessionmaker, interval_hours=0)

    timer.start()

    assert timer.enabled is False
    assert timer._task is None  # noqa: SLF001
    await asyncio.sleep(0)  # give a task, if one had been made, the chance to run
    assert (await _requested(db_sessionmaker))[1] is None
    await timer.aclose()  # closing something that never started is not an error


async def test_a_started_timer_stops_cleanly(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # Shutdown has to be bounded and quiet: the timer is cancelled, and cancelling is not a crash.
    await _seed(db_sessionmaker, last_checked_at=datetime.now(UTC))  # not due; catch-up no-ops
    timer = _timer(db_sessionmaker)

    timer.start()
    started = timer._task  # noqa: SLF001
    assert started is not None
    await asyncio.sleep(0)
    await timer.aclose()

    assert started.cancelled() or started.done()
    assert timer._task is None  # noqa: SLF001


async def test_a_started_timer_says_when_it_will_run_next(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # What the Sources page's one line reads. Set before the first sleep, so the page can answer
    # "next" without waiting a week for the answer to become true.
    timer = _timer(db_sessionmaker, interval_hours=1)

    timer.start()
    await asyncio.sleep(0)
    try:
        assert timer.next_run_at is not None
        ahead = timer.next_run_at - datetime.now(UTC)
        assert timedelta(minutes=59) < ahead <= timedelta(hours=1)
    finally:
        await timer.aclose()
