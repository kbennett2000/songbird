"""DB-backed session lifecycle (mirrors soap-journal). A random token lives in an httponly
cookie; the session row is the source of truth, so logout is a real server-side revocation."""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.db.models import UserSession

SESSION_TTL = timedelta(days=30)
SESSION_TOKEN_BYTES = 48


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    # SQLite may return naive datetimes; treat them as UTC for comparison.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def create_session(db: AsyncSession, user_id: int) -> UserSession:
    now = _utcnow()
    session = UserSession(
        user_id=user_id,
        token=secrets.token_urlsafe(SESSION_TOKEN_BYTES),
        created_at=now,
        expires_at=now + SESSION_TTL,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def get_session(db: AsyncSession, token: str) -> UserSession | None:
    result = await db.execute(select(UserSession).where(UserSession.token == token))
    session = result.scalar_one_or_none()
    if session is None or _aware(session.expires_at) <= _utcnow():
        return None
    return session


async def extend_session(db: AsyncSession, session: UserSession) -> None:
    session.expires_at = _utcnow() + SESSION_TTL
    await db.commit()


async def delete_session(db: AsyncSession, token: str) -> None:
    await db.execute(delete(UserSession).where(UserSession.token == token))
    await db.commit()


async def cleanup_expired_sessions(db: AsyncSession, user_id: int) -> None:
    await db.execute(
        delete(UserSession).where(
            UserSession.user_id == user_id, UserSession.expires_at <= _utcnow()
        )
    )
    await db.commit()


async def cleanup_all_expired_sessions(db: AsyncSession) -> int:
    """Sweep EVERY user's expired sessions, not just one user's. The per-user cleanup above only
    runs on a user's next login, so rows for users who never return would otherwise accumulate.
    Returns the number swept. Hygiene only — expiry is already enforced on read (`get_session`)."""
    expired = UserSession.expires_at <= _utcnow()
    count: int = await db.scalar(select(func.count()).select_from(UserSession).where(expired)) or 0
    if count:
        await db.execute(delete(UserSession).where(expired))
        await db.commit()
    return count
