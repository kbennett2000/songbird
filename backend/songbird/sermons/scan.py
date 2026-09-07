"""The catalogue scan (v1.7 sermon sources, spec §6) — slice 4a's half of it.

A check reads a source's playlist, fetches the details of every video it has not seen, applies
spec §6's filters, and writes a ledger row saying what it decided. It stops there. Working out
which passage a sermon preaches on, and creating the note, is slice 4b's job and needs Concord;
this needs only YouTube. The seam between them is the `pending` status: 4a writes it, 4b consumes
it, and a scan is therefore resumable — either half can fail without losing the other's work.

The file is in two parts, and the order is the point. The top is pure: given a video and a
source's settings, what should happen? No database, no HTTP, no settings lookup — so every rule
in spec §6 is one line of test. The bottom is `ScanRunner`, which is all the I/O: the paging, the
batching, the commits, and the one background task.
"""

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final, Literal

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from songbird.db.models import SermonNote, SermonSource, SermonSourceVideo
from songbird.youtube.client import (
    YouTubeAuthError,
    YouTubeClient,
    YouTubeError,
    YouTubeNotFoundError,
    YouTubeQuotaError,
)
from songbird.youtube.schemas import Video

logger = logging.getLogger("songbird")

# videos.list takes 50 ids for one quota unit, which is what makes a back catalogue affordable.
_DETAIL_BATCH: Final = 50

# How long shutdown waits for a cancelled scan before abandoning it. A constant rather than an
# argument: it is uvicorn's shutdown budget, not something a caller should get to vary.
_SHUTDOWN_TIMEOUT: Final = 5.0

LedgerStatus = Literal["pending", "skipped", "already_noted"]
SkipReason = Literal["too_short", "live_excluded"]
PagingMode = Literal["full", "incremental"]


# --- The pure core: no database, no HTTP, no settings ----------------------------------------


@dataclass(frozen=True, slots=True)
class SourceRule:
    """Everything the per-video decision needs from a source, already resolved.

    Resolved values rather than the row, because `min_minutes` is nullable and falls back to the
    app-wide setting — and doing that lookup inside the decision would drag `get_settings()` into
    the one function that has to be testable with nothing but its arguments.
    """

    min_seconds: int
    include_live: bool


@dataclass(frozen=True, slots=True)
class Decision:
    """What to do with one video, once it has earned a ledger row at all."""

    status: LedgerStatus
    skip_reason: SkipReason | None


def source_rule(
    *, min_minutes: int | None, include_live: bool, default_min_minutes: int
) -> SourceRule:
    """A source's filter settings, with the app-wide minimum filled in.

    `min_minutes` is null for most sources and null MEANS "follow SERMON_MIN_MINUTES" — that is
    the whole reason the column is nullable, so that raising the app-wide floor later reaches
    every source that never overrode it.
    """
    minutes = default_min_minutes if min_minutes is None else min_minutes
    return SourceRule(min_seconds=minutes * 60, include_live=include_live)


def decide(video: Video, rule: SourceRule, *, already_noted: bool) -> Decision | None:
    """Spec §6's four filters, in spec §6's order. `None` means leave no trace at all.

    `None` is filter 1 and only filter 1: a live or upcoming broadcast is re-seen once it
    finishes, and a ledger row would make it look decided. Returning None rather than a
    `Decision` carrying a "don't write this" flag means the caller cannot forget to check —
    pyright makes it narrow the value before it can build a row from it.

    `already_noted` arrives as a boolean because answering it is a query over the AUTHOR's sermon
    notes: an edge, not a rule.

    The ORDER is load-bearing. A too-short livestream on a source with livestreams switched off is
    `too_short`, not `live_excluded` — that is the order the spec lists, and the reason a reader
    is shown has to be stable rather than depending on which check happened to run first.
    """
    if video.live_broadcast_content in ("live", "upcoming"):
        return None
    # `is not None` first, and this is the whole point of spec §6.2: an unknown duration is not a
    # short one. Filing it under `too_short` would record a reason it has not earned — the
    # opposite of that section's promise that nothing is silently hidden. A genuine PT0S is 0 and
    # is still too short.
    if video.duration_seconds is not None and video.duration_seconds < rule.min_seconds:
        return Decision("skipped", "too_short")
    if video.is_livestream and not rule.include_live:
        return Decision("skipped", "live_excluded")
    if already_noted:
        return Decision("already_noted", None)
    return Decision("pending", None)


def paging_mode(*, kind: str, scan_complete: bool) -> PagingMode:
    """How far into the catalogue this check must page — two different reasons to walk it all.

    A **playlist** is walked in full every time. Its order is the curator's, not chronological, so
    "everything on this page is already known" says nothing at all about the next page.

    A **channel whose last check did not finish** is walked in full, because the incremental stop
    rule assumes every page above the stop is complete. A check that committed page one and then
    died at page two left a hole that page one would hide from every future check, forever.

    A never-scanned source falls out of the second case for free: `scan_complete` defaults to
    False, so its first check is the whole back catalogue spec §5 promises.
    """
    if kind == "playlist" or not scan_complete:
        return "full"
    return "incremental"


def stop_here(mode: PagingMode, unseen: Sequence[str]) -> bool:
    """Whether this page is the last one worth reading (spec §6).

    Only in incremental mode, and only when the page held nothing new: an uploads playlist is
    newest-first, so a page we have entirely seen means everything below it is older still and
    already ours.
    """
    return mode == "incremental" and not unseen


# --- What a check records about itself (spec §4's `last_check_status`) ------------------------

STATUS_OK: Final = "ok"

STATUS_QUOTA: Final = "YouTube's daily limit is used up. Checking will resume once it resets."

# Names the setting, never its value — this string is stored and rendered in a browser, and the
# key is a secret (spec §2).
STATUS_KEY_REJECTED: Final = (
    "YouTube rejected the API key. Check YOUTUBE_API_KEY in songbird's configuration."
)

STATUS_UNREACHABLE: Final = "Couldn't reach YouTube. songbird will try again at the next check."

# "Or made private" is not hedging: private is at least as likely as deleted, and telling someone
# their church deleted its channel is a bad way to be wrong.
STATUS_GONE: Final = (
    "YouTube no longer has this channel or playlist. It may have been deleted or made private — "
    "check the link, or remove this source."
)

STATUS_UNKNOWN: Final = (
    "Something went wrong during the check. songbird will try again at the next check."
)


def status_for(exc: YouTubeError) -> str:
    """The plain-English line a person reads beside "last checked" (spec §4).

    Two shapes, and the difference is whether there is anything to do. Quota and unreachable are
    weather: they say what happened and that nothing is required. A rejected key and a vanished
    channel need a human, so they name what to look at.

    Nothing here interpolates `str(exc)`. Those messages are redacted, but they read like an API
    ("YouTube returned an unexpected status: 503") and this line sits on a card next to a church's
    name. Google's `reason` token is appended for a rejected key alone — it is Google's word, not
    the key, and it is the one case where whoever fixes it genuinely needs the detail.
    """
    if isinstance(exc, YouTubeQuotaError):
        return STATUS_QUOTA
    if isinstance(exc, YouTubeAuthError):
        if exc.reason:
            return f"{STATUS_KEY_REJECTED} (YouTube said: {exc.reason})"
        return STATUS_KEY_REJECTED
    if isinstance(exc, YouTubeNotFoundError):
        return STATUS_GONE
    return STATUS_UNREACHABLE


# --- The I/O edge: the background runner ------------------------------------------------------


@dataclass(frozen=True, slots=True)
class DueSource:
    """A source waiting to be checked, as ids and timestamps rather than an ORM object.

    An ORM object belongs to the session that loaded it, and the session that answers "what is
    due?" closes immediately — each source is then scanned in a session of its own.
    """

    id: int
    # Naive when SQLite hands it back, and used ONLY as an identity key (see `ScanRunner.run`).
    # Never compared in Python against an aware `datetime.now(UTC)`; that is a TypeError.
    requested_at: datetime | None

    @property
    def key(self) -> tuple[int, datetime | None]:
        return (self.id, self.requested_at)


@dataclass(slots=True)
class ScanProgress:
    """How far a source's walk got, so a failure can say whether it left a hole.

    Mutable and passed down on purpose: `_walk` raises out through several layers, and the one
    thing the recorder needs from it — did we actually consume a page? — has to survive the
    unwind.
    """

    pages_done: int = 0
    ledgered: int = 0

    @property
    def complete_flag(self) -> bool | None:
        """What to write to `scan_complete` after a FAILED walk.

        `False` if we got far enough to leave a gap; `None` — meaning leave the column alone — if
        we never consumed a page at all. Without that second case every transient blip would
        force a full re-walk of every catalogue on the next check, which is an expensive way to
        record that nothing happened.
        """
        return False if self.pages_done else None


class ScanRunner:
    """The one background scan — the first thing in songbird that outlives a request.

    It owns a session FACTORY, never a session. A session belongs to a request; this work does
    not, and borrowing one would tie a scan that runs for minutes to a connection the client is
    free to drop half way through.

    Everything it needs is a constructor argument, and nothing is reached for globally — no
    `get_settings()`, no `async_session_factory` import. That is the whole testability story: the
    fast suite builds one over the in-memory database and a fake YouTube and awaits `run()`
    directly, so no test ever creates a task, sleeps, or polls.
    """

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        youtube: YouTubeClient,
        *,
        default_min_minutes: int,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._youtube = youtube
        self._default_min_minutes = default_min_minutes
        self._task: asyncio.Task[None] | None = None
        self._requested = False
        self._closing = False
        self.started_at: datetime | None = None

    @property
    def running(self) -> bool:
        """Whether a scan is in flight — what the Sources page's "checking…" reads.

        A plain property, not a coroutine: `/status` is polled every few seconds and must never
        await the runner to answer.
        """
        return self._task is not None and not self._task.done()

    def request_scan(self) -> None:
        """Make sure a scan happens, and make sure only one is happening. Synchronous ON PURPOSE.

        The whole "at most one" guarantee is that this method contains no `await`. On a
        single-threaded event loop nothing can run between the `done()` test and the
        `create_task`, so two callers cannot both find no task and both start one. Keeping it a
        plain `def` is what stops a later edit from putting an await into the one critical
        section in this file.

        `_requested` is the other half, and it closes a race a `done()` check alone cannot: a run
        that has just asked "anything left?" and is about to return is still not `done()`, so a
        request arriving in that window would find a live task and be silently dropped. Setting
        the flag here, and clearing it *before* each due-query in `run`, means every request made
        from this moment on is seen by someone.

        `started_at` is set HERE rather than inside the task for a reason that reaches the
        browser: the page starts polling only once it has seen `scan_running` true, and it asks
        immediately after this call's 202. If the flag were set by the task, that first refetch
        could win the race and the page would never start polling at all.
        """
        if self._closing:
            return  # shutting down; the request is on the row and survives the restart
        self._requested = True
        if self._task is None or self._task.done():
            self.started_at = datetime.now(UTC)
            self._task = asyncio.create_task(self.run(), name="sermon-scan")
            self._task.add_done_callback(self._on_task_done)

    def _on_task_done(self, task: asyncio.Task[None]) -> None:
        """Log a crash once, here, with its traceback.

        Nothing awaits this task, so without this an exception would sit on it until the garbage
        collector noticed and printed "Task exception was never retrieved" — detached from the
        moment it happened and from any log line that would explain it. Cancellation is not a
        crash: it is how shutdown works.
        """
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            logger.error("sermon scan run failed", exc_info=error)

    async def run(self) -> None:
        """Scan every due source, then everything that became due while we were scanning.

        Awaitable and task-free, which is how the tests drive it — `request_scan` is the only
        thing that makes a task. Not re-entrant: two concurrent `run()` calls would both scan, and
        `request_scan` is what prevents that in production.

        Each pass re-queries, so a "check now" landing mid-run is picked up rather than lost. The
        pass then works from a snapshot list: a source that becomes due while we are iterating
        waits for the next pass instead of being appended to the list we are walking, because a
        list that grows while you walk it is a scan that never ends.

        `attempted` is a liveness guard, not a correctness one, and it is keyed on the request
        timestamp we SAW for a specific reason. Re-querying means a source whose result we failed
        to record stays due and would be scanned again, and again, burning YouTube quota against a
        database that is not answering. A genuinely new "check now" carries a new timestamp and so
        is not in the set; a source we simply could not write to carries the same one and is
        skipped for the rest of this run.
        """
        attempted: set[tuple[int, datetime | None]] = set()
        while True:
            # Cleared BEFORE the query, so a request made while the query is in flight is seen.
            self._requested = False
            due = [d for d in await self._due_sources() if d.key not in attempted]
            if not due:
                if self._requested:
                    continue  # someone asked while we were asking — ask again
                return
            for source in due:
                attempted.add(source.key)
                if not await self._scan_source(source):
                    logger.warning("sermon scan stopped: YouTube's daily quota is spent")
                    return

    async def aclose(self) -> None:
        """Stop a scan in progress so shutdown neither hangs nor logs a swallowed error.

        Cancel and AWAIT, not fire-and-forget: the task holds the YouTube client the lifespan is
        about to close, and an in-flight request against a closed transport raises inside a task
        nobody is awaiting — asyncio then prints "Task exception was never retrieved" at
        interpreter exit, which is the worst possible last line of a clean shutdown.

        Bounded, because uvicorn's shutdown has to finish: a scan that will not stop within the
        timeout is abandoned rather than allowed to hold the process open. `_closing` is set first
        so a request landing during shutdown records itself on the row and returns without
        starting anything — the check is not lost, it just happens after the restart.

        A cancelled scan records NOTHING. Writing `last_checked_at` would clear the source's
        dueness and hide a check that never happened; leaving the row alone means the next boot
        finds it still due.
        """
        self._closing = True
        task = self._task
        if task is None or task.done():
            return
        task.cancel()
        try:
            await asyncio.wait_for(task, _SHUTDOWN_TIMEOUT)
        except (asyncio.CancelledError, TimeoutError):
            # Cancelled is the expected outcome, not a failure; a timeout we accept rather than
            # hold uvicorn open on a scan that will not stop.
            pass

    async def _due_sources(self) -> list[DueSource]:
        """Every enabled source that wants checking.

        Two ways to be due, and they are different states: someone asked (`check_requested_at`),
        or it has never been checked at all — a source added while songbird was stopped must still
        get its first catalogue scan (spec §5). Disabled sources are never due: switching a source
        off is how you stop it costing quota.

        Never-checked sources sort first (SQLite orders NULL low), which is the right queue: a
        source someone just added is the one they are watching the page for.
        """
        stmt = (
            select(SermonSource.id, SermonSource.check_requested_at)
            .where(
                SermonSource.enabled.is_(True),
                or_(
                    SermonSource.check_requested_at.is_not(None),
                    SermonSource.last_checked_at.is_(None),
                ),
            )
            .order_by(SermonSource.check_requested_at, SermonSource.id)
        )
        async with self._sessionmaker() as db:
            rows = (await db.execute(stmt)).all()
        return [DueSource(id=row[0], requested_at=row[1]) for row in rows]

    async def _scan_source(self, due: DueSource) -> bool:
        """Check one source and record the outcome — always. False means the whole run stops.

        The status write gets its OWN session, opened after the scanning session has closed. That
        is not tidiness: an `AsyncSession` whose flush raised refuses every later statement until
        it is rolled back, so writing `last_check_status` on the session that just failed is the
        one path guaranteed to be broken exactly when it is needed.
        """
        started_at = datetime.now(UTC)
        progress = ScanProgress()
        try:
            async with self._sessionmaker() as db:
                source = await db.get(SermonSource, due.id)
                if source is None or not source.enabled:
                    return True  # deleted or paused since the query — nothing to record
                await self._walk(db, source, progress)
            await self._record_check(due, started_at, STATUS_OK, True)
            return True
        except YouTubeQuotaError as exc:
            # Quota is not this source's fault, and retrying anything today is wasted: record it
            # and let the caller stop the whole run (spec §6).
            await self._record_check(due, started_at, status_for(exc), progress.complete_flag)
            return False
        except YouTubeError as exc:
            await self._record_check(due, started_at, status_for(exc), progress.complete_flag)
            return True
        except Exception:
            # Anything not from YouTube — a bad row, a bug. Logged in full here because the status
            # the owner sees deliberately says nothing technical. Note this cannot swallow
            # CancelledError, which is a BaseException in 3.12, so shutdown unwinds cleanly.
            logger.exception("sermon source %d: check failed", due.id)
            await self._record_check(due, started_at, STATUS_UNKNOWN, progress.complete_flag)
            return True

    async def _record_check(
        self, due: DueSource, started_at: datetime, status: str, complete: bool | None
    ) -> None:
        """Stamp the outcome on the source, in a session of its own.

        The `check_requested_at` clear is CONDITIONAL, and the condition is the point: a "check
        now" pressed while this very source was being scanned arrives with a timestamp LATER than
        `started_at`, so `<= started_at` leaves it standing and the run's next pass picks it up.
        Clearing unconditionally would drop it with no error and no retry — a button that visibly
        did nothing, which is the worst shape a bug can have.

        `started_at` does double duty as `last_checked_at` on purpose: one timestamp, one meaning
        — the instant this check's view of the world was taken — which is exactly what both the
        display and the clear need.

        Never raises. A run that cannot record its own outcome must still hand control back to the
        loop, which has its own guard against re-scanning a source it could not write to.
        """
        try:
            async with self._sessionmaker() as db:
                values: dict[str, object] = {
                    "last_checked_at": started_at,
                    "last_check_status": status,
                }
                if complete is not None:
                    values["scan_complete"] = complete
                await db.execute(
                    update(SermonSource).where(SermonSource.id == due.id).values(**values)
                )
                await db.execute(
                    update(SermonSource)
                    .where(
                        SermonSource.id == due.id,
                        SermonSource.check_requested_at <= started_at,
                    )
                    .values(check_requested_at=None)
                )
                await db.commit()  # both statements, one transaction
        except Exception:
            logger.exception("sermon source %d: could not record the check result", due.id)

    async def _walk(self, db: AsyncSession, source: SermonSource, progress: ScanProgress) -> None:
        """Page the source's catalogue newest-first and ledger everything unseen.

        `seen_this_run` is not an optimisation. YouTube pages over a list that shifts while you
        walk it, so the same id can legitimately arrive on two pages — and inserting it twice is
        an IntegrityError on (author_id, video_id) that would abort the whole batch.

        Unseen ids are buffered ACROSS pages because a `videos.list` call costs the same single
        quota unit for three ids as for fifty.
        """
        playlist_id = source.uploads_playlist_id or source.youtube_id
        mode = paging_mode(kind=source.kind, scan_complete=source.scan_complete)
        rule = source_rule(
            min_minutes=source.min_minutes,
            include_live=source.include_live,
            default_min_minutes=self._default_min_minutes,
        )
        seen_this_run: set[str] = set()
        buffer: list[str] = []
        page_token: str | None = None

        while True:
            page = await self._youtube.list_playlist_page(playlist_id, page_token)
            known = seen_this_run | await self._ledgered(db, source.author_id, page.video_ids)
            unseen = [v for v in page.video_ids if v not in known]
            progress.pages_done += 1

            if stop_here(mode, unseen):
                break

            buffer.extend(unseen)
            seen_this_run.update(unseen)
            while len(buffer) >= _DETAIL_BATCH:
                await self._process(db, source, rule, buffer[:_DETAIL_BATCH], progress)
                del buffer[:_DETAIL_BATCH]

            if page.next_page_token is None:
                break
            page_token = page.next_page_token

        if buffer:
            await self._process(db, source, rule, buffer, progress)

    async def _ledgered(self, db: AsyncSession, author_id: int, ids: Sequence[str]) -> set[str]:
        """Which of these videos this AUTHOR has already seen, in any of their sources.

        Author-scoped rather than source-scoped because that is what the ledger's uniqueness says:
        a church whose curated playlist repeats its own uploads must not ledger the same sermon
        twice, and later note it twice. The first source to see a video owns its row.
        """
        if not ids:
            return set()
        stmt = select(SermonSourceVideo.video_id).where(
            SermonSourceVideo.author_id == author_id,
            SermonSourceVideo.video_id.in_(ids),
        )
        return set((await db.execute(stmt)).scalars().all())

    async def _already_noted(
        self, db: AsyncSession, author_id: int, ids: Sequence[str]
    ) -> set[str]:
        """Which of these videos this AUTHOR has already written a sermon note about (spec §6.4).

        Scoped to the author, so another user's note about the same sermon does not make this
        user's copy look already handled.
        """
        if not ids:
            return set()
        stmt = select(SermonNote.youtube_video_id).where(
            SermonNote.author_id == author_id,
            SermonNote.youtube_video_id.in_(ids),
        )
        return {v for v in (await db.execute(stmt)).scalars().all() if v is not None}

    async def _process(
        self,
        db: AsyncSession,
        source: SermonSource,
        rule: SourceRule,
        video_ids: list[str],
        progress: ScanProgress,
    ) -> None:
        """Fetch up to 50 unseen videos, decide each one, and commit the batch.

        Per batch and not per source: spec §6 calls the ledger the checkpoint. Fifty videos is one
        quota unit and about a second of work, so that is a cheap thing to lose to a failure — and
        re-running is safe, because everything committed is now "seen".

        Ids YouTube declines to return (private, deleted, age-gated) are simply absent from the
        result and are NOT ledgered. Known limitation, recorded in spec §13: they look unseen on
        every future check, which costs a couple of quota units per scan for as long as they sit
        in the newest page.
        """
        videos = await self._youtube.get_videos(video_ids)
        noted = await self._already_noted(db, source.author_id, [v.id for v in videos])
        now = datetime.now(UTC)
        for video in videos:
            decision = decide(video, rule, already_noted=video.id in noted)
            if decision is None:
                continue  # live or upcoming — spec §6.1, no trace at all until it has finished
            db.add(
                SermonSourceVideo(
                    source_id=source.id,
                    author_id=source.author_id,
                    video_id=video.id,
                    title=video.title,
                    description=video.description,
                    published_at=video.published_at,
                    duration_seconds=video.duration_seconds,
                    is_live=video.is_livestream,
                    status=decision.status,
                    skip_reason=decision.skip_reason,
                    seen_at=now,
                    # A skip or an already-noted row is decided the moment it is written; only
                    # `pending` is still waiting for slice 4b to say something about it.
                    decided_at=None if decision.status == "pending" else now,
                )
            )
            progress.ledgered += 1
        if source.scan_complete:
            # Goes False in the SAME commit as the first batch, so that a scan killed by a restart
            # or a power cut — neither of which reaches `_record_check` — still leaves the next
            # check unwilling to trust a stop rule whose premise died with the process.
            source.scan_complete = False
        await db.commit()
