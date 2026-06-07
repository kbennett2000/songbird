"""The global expired-session sweep removes every user's expired sessions — not just one
user's, the way per-login cleanup does — and leaves live sessions untouched."""

from datetime import UTC, datetime, timedelta

from songbird.core.sessions import cleanup_all_expired_sessions
from songbird.db.models import User, UserSession
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def test_sweeps_expired_sessions_across_all_users(db_session: AsyncSession) -> None:
    now = datetime.now(UTC)
    expired = now - timedelta(days=1)
    live = now + timedelta(days=1)

    db_session.add(User(id=2, name="other"))  # user 1 is seeded by the fixture
    db_session.add_all(
        [
            UserSession(user_id=1, token="u1-expired", created_at=expired, expires_at=expired),
            UserSession(user_id=1, token="u1-live", created_at=now, expires_at=live),
            UserSession(user_id=2, token="u2-expired-a", created_at=expired, expires_at=expired),
            UserSession(user_id=2, token="u2-expired-b", created_at=expired, expires_at=expired),
        ]
    )
    await db_session.commit()

    swept = await cleanup_all_expired_sessions(db_session)
    assert swept == 3  # both users' expired rows, not just one user's

    remaining = (await db_session.execute(select(UserSession.token))).scalars().all()
    assert set(remaining) == {"u1-live"}


async def test_sweep_no_op_when_nothing_expired(db_session: AsyncSession) -> None:
    live = datetime.now(UTC) + timedelta(days=1)
    db_session.add(UserSession(user_id=1, token="live", expires_at=live))
    await db_session.commit()

    assert await cleanup_all_expired_sessions(db_session) == 0
    remaining = (await db_session.execute(select(UserSession.token))).scalars().all()
    assert set(remaining) == {"live"}
