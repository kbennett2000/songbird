"""FastAPI dependencies."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.concord.client import ConcordClient
from songbird.core.cookies import COOKIE_NAME
from songbird.core.errors import ErrorCode, raise_http
from songbird.core.sessions import extend_session, get_session
from songbird.db.models import User
from songbird.db.session import get_db
from songbird.sermons.scan import ScanRunner
from songbird.sermons.schedule import ScheduledCheck
from songbird.youtube.client import YouTubeClient

__all__ = [
    "get_concord_client",
    "get_current_user",
    "get_current_user_optional",
    "get_db",
    "get_scan_runner_optional",
    "get_youtube_client",
    "get_youtube_client_optional",
]


def get_concord_client(request: Request) -> ConcordClient:
    """Return the process-wide Concord client built in the app lifespan.

    Overridden in tests to inject a fake — no live Concord needed for the fast suite.
    """
    client: ConcordClient = request.app.state.concord
    return client


def get_youtube_client_optional(request: Request) -> YouTubeClient | None:
    """The process-wide YouTube client built in the app lifespan, or None if no key was set.

    Read via `getattr` because the fast test suite never runs the lifespan, so the attribute may
    not exist at all. This is the seam the whole feature hangs off: the Sources page's status
    endpoint has to ANSWER when there is no key (that answer is the setup message), so it cannot
    use the demanding version below.
    """
    client: YouTubeClient | None = getattr(request.app.state, "youtube", None)
    return client


def get_scan_runner_optional(request: Request) -> ScanRunner | None:
    """The process-wide sermon scan runner built in the app lifespan, or None if there isn't one.

    `getattr` for exactly the reason the YouTube seam above uses it: the fast test suite never
    runs the lifespan, so `app.state.sermon_scan` may not exist at all — and `/status` has to
    ANSWER ("nothing is running", which is true) rather than 500.

    There is deliberately no demanding variant. A missing runner is a test-shaped condition, not a
    user-facing one, and the routes that queue work still write `check_requested_at` — so nothing
    is lost when there is nobody to start; the request is simply picked up after the next boot.
    """
    runner: ScanRunner | None = getattr(request.app.state, "sermon_scan", None)
    return runner


def get_scheduled_check_optional(request: Request) -> ScheduledCheck | None:
    """The interval timer built in the app lifespan, or None if there isn't one.

    `getattr` and optional for the same two reasons as the runner above: the fast suite never runs
    the lifespan, and a box with no key has no timer to report on. `/status` answers either way.
    """
    schedule: ScheduledCheck | None = getattr(request.app.state, "sermon_schedule", None)
    return schedule


def get_youtube_client(
    youtube: YouTubeClient | None = Depends(get_youtube_client_optional),
) -> YouTubeClient:
    """The YouTube client, or 409 if there is none.

    No key configured means the feature is simply switched off (spec §2), which is a normal
    state and not a server fault — hence 409 rather than 500 or 503. Every route that actually
    talks to YouTube depends on this one, so none of them needs its own check.
    """
    if youtube is None:
        raise_http(
            409,
            ErrorCode.YOUTUBE_NOT_CONFIGURED,
            "No YouTube API key is configured, so sermon sources are switched off.",
        )
    return youtube


async def _resolve_user(request: Request, db: AsyncSession) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    session = await get_session(db, token)
    if session is None:
        return None
    user = await db.get(User, session.user_id)
    if user is None:
        return None
    await extend_session(db, session)  # sliding window
    return user


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """The logged-in user, or 401. Auth is songbird's domain; Concord never sees a user."""
    user = await _resolve_user(request, db)
    if user is None:
        raise_http(401, ErrorCode.NOT_AUTHENTICATED, "Not authenticated")
    return user


async def get_current_user_optional(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User | None:
    return await _resolve_user(request, db)
