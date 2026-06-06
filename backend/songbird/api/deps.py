"""FastAPI dependencies."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.concord.client import ConcordClient
from songbird.core.cookies import COOKIE_NAME
from songbird.core.errors import ErrorCode, raise_http
from songbird.core.sessions import extend_session, get_session
from songbird.db.models import User
from songbird.db.session import get_db

__all__ = [
    "get_concord_client",
    "get_current_user",
    "get_current_user_optional",
    "get_db",
]


def get_concord_client(request: Request) -> ConcordClient:
    """Return the process-wide Concord client built in the app lifespan.

    Overridden in tests to inject a fake — no live Concord needed for the fast suite.
    """
    client: ConcordClient = request.app.state.concord
    return client


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
