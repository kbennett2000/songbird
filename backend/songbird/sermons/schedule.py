"""The scheduled check (v1.7 sermon sources, spec §6c) — the timer, and only the timer.

songbird is one process, so an in-process `asyncio` task is enough: no sidecar, no cron, nothing
to install. Every `SERMON_CHECK_INTERVAL_HOURS` this stamps `check_requested_at` on every enabled
source and asks the scan runner to go. **It contains no scan logic of its own** — `ScanRunner`
already knows how to find what is due, page a catalogue, and stop; this file only decides *when*.

That division is also why nothing here starts a task of its own. `ScanRunner.request_scan()` is
the single guard against two scans running at once, and its guarantee is that it contains no
`await`. A timer that created its own scan task would step straight around it.

**Boot catch-up is what makes a weekly interval survive a restart.** A timer that only ever fires
after a full interval would, on a box rebooted every night, never fire at all. So at start-up any
enabled source last checked longer ago than the interval — or never checked — makes the timer fire
immediately. A box that was off for two weeks catches up the moment it comes back.

The two rules are deliberately different, and the asymmetry is the design:

* **at boot** — fire only if something is actually due, so a restart is not a free full check;
* **on the interval** — stamp every enabled source, because the interval elapsing *is* the event.

The cost of the second is that a source added an hour before the tick gets re-walked an hour
later. Spec §6 makes that cheap on purpose: re-paging a catalogue songbird has already seen is one
quota unit per page and no detail calls at all.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from songbird.db.models import SermonSource
from songbird.sermons.scan import ScanRunner

logger = logging.getLogger("songbird")

# Shutdown's budget for stopping the timer. The same constant `ScanRunner` uses, for the same
# reason: uvicorn's shutdown has to finish.
_SHUTDOWN_TIMEOUT: Final = 5.0


def is_due(last_checked_at: datetime | None, now: datetime, interval_hours: int) -> bool:
    """Has this source gone longer than the interval without a check?

    Pure, and pure on purpose: it is the one piece of arithmetic in this file worth testing, and a
    function makes it testable without a clock. Nothing in this suite fakes time.

    **`last_checked_at` may be naive.** SQLite hands `DateTime(timezone=True)` back without its
    offset, so comparing the column's value straight against an aware `datetime.now(UTC)` raises
    `TypeError` — the trap `DueSource.requested_at` documents in `scan.py`. A naive value is read
    as UTC here, which is what it always was: every writer in songbird stores `datetime.now(UTC)`.

    Never checked is due. A source added while songbird was stopped has to get its first catalogue
    scan, and `ScanRunner._due_sources` already agrees.
    """
    if last_checked_at is None:
        return True
    if last_checked_at.tzinfo is None:
        last_checked_at = last_checked_at.replace(tzinfo=UTC)
    return last_checked_at <= now - timedelta(hours=interval_hours)


class ScheduledCheck:
    """The interval timer. One task, started by the lifespan and stopped by it.

    Built like `ScanRunner`: it owns a session FACTORY rather than a session, and everything it
    needs is a constructor argument — no `get_settings()`, no imported session factory. The fast
    suite awaits `fire()` and `catch_up()` directly, so no test ever creates a task or sleeps.
    """

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        runner: ScanRunner,
        *,
        interval_hours: int,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._runner = runner
        self._interval_hours = interval_hours
        self._task: asyncio.Task[None] | None = None
        self.last_run_at: datetime | None = None
        self.next_run_at: datetime | None = None

    @property
    def enabled(self) -> bool:
        """Whether the schedule runs at all. `0` hours means off — spec §3."""
        return self._interval_hours > 0

    @property
    def interval_hours(self) -> int:
        return self._interval_hours

    def start(self) -> None:
        """Start the timer, unless the interval says not to.

        A disabled schedule creates **no task at all**, rather than a task that wakes up and
        declines to do anything. "Off" should be visible in a stack dump, not just in a branch.
        """
        if not self.enabled or self._task is not None:
            return
        self._task = asyncio.create_task(self._loop(), name="sermon-schedule")
        self._task.add_done_callback(self._on_task_done)

    def _on_task_done(self, task: asyncio.Task[None]) -> None:
        """Log a crash once, here — the same reason `ScanRunner` does.

        Nothing awaits this task, so an exception would otherwise sit on it until the garbage
        collector printed "Task exception was never retrieved", detached from the moment it
        happened. Cancellation is not a crash; it is how shutdown works.
        """
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            logger.error("scheduled check failed", exc_info=error)

    async def aclose(self) -> None:
        """Stop the timer. Cancel and AWAIT, bounded — `ScanRunner.aclose`'s shape and its reasons.

        The lifespan closes this BEFORE the scan runner: the timer's whole job is to start scans,
        so stopping it first means the runner is not handed new work while it is shutting down.
        """
        task = self._task
        self._task = None
        if task is None or task.done():
            return
        task.cancel()
        try:
            await asyncio.wait_for(task, _SHUTDOWN_TIMEOUT)
        except (asyncio.CancelledError, TimeoutError):
            pass

    async def catch_up(self) -> bool:
        """Fire once at boot if any enabled source is overdue. True if it fired.

        Dueness is decided in Python rather than SQL, over what is realistically a handful of rows,
        because the comparison has to cope with SQLite's naive datetimes (see `is_due`) and because
        a pure function is a thing a test can pin without a clock.
        """
        stmt = select(SermonSource.last_checked_at).where(SermonSource.enabled.is_(True))
        async with self._sessionmaker() as db:
            checked = list((await db.execute(stmt)).scalars().all())
        now = datetime.now(UTC)
        if not any(is_due(when, now, self._interval_hours) for when in checked):
            return False
        await self.fire()
        return True

    async def fire(self) -> int:
        """Ask for a check of every enabled source. Returns how many were asked for.

        Global, not author-scoped: this is the box's schedule, not one person's. A disabled source
        is left alone — switching a source off is how you stop it costing quota (spec §6).

        The row is written and COMMITTED before the runner is told, so a request that arrives here
        survives a crash in between: the durable half of "check now" is the column, exactly as the
        API endpoints do it.
        """
        now = datetime.now(UTC)
        stmt = (
            update(SermonSource)
            .where(SermonSource.enabled.is_(True))
            .values(check_requested_at=now)
        )
        async with self._sessionmaker() as db:
            queued = (await db.execute(stmt)).rowcount
            await db.commit()
        self.last_run_at = now
        logger.info("scheduled check: %d source(s) queued", queued)
        self._runner.request_scan()
        return queued

    async def _loop(self) -> None:
        """Catch up on what is overdue, then fire every interval, for ever."""
        interval_seconds = self._interval_hours * 3600
        self.next_run_at = datetime.now(UTC) + timedelta(hours=self._interval_hours)
        await self.catch_up()
        while True:
            await asyncio.sleep(interval_seconds)
            await self.fire()
            self.next_run_at = datetime.now(UTC) + timedelta(hours=self._interval_hours)
