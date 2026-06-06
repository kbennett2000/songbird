"""Auth — register / login / logout / me (Argon2 cookie-session, mirroring soap-journal).
Entirely songbird's domain: Concord never learns about users.

The seeded default user (id=1, unclaimed: no password_hash) is **claimed** by the first
registration, so the annotations it already owns stay put rather than being orphaned.
"""

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_current_user, get_db
from songbird.api.schemas import AuthEnvelope, LoginRequest, RegisterRequest, UserResponse
from songbird.core.cookies import COOKIE_NAME, clear_session_cookie, set_session_cookie
from songbird.core.errors import ErrorCode, raise_http
from songbird.core.passwords import hash_password, verify_password
from songbird.core.sessions import (
    cleanup_expired_sessions,
    create_session,
    delete_session,
)
from songbird.db.models import User

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


async def _get_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _unclaimed_default(db: AsyncSession) -> User | None:
    """The original seeded user, still without credentials — claimable by the first signup."""
    result = await db.execute(
        select(User).where(User.password_hash.is_(None)).order_by(User.id).limit(1)
    )
    return result.scalar_one_or_none()


async def _any_claimed_user(db: AsyncSession) -> bool:
    result = await db.execute(
        select(func.count()).select_from(User).where(User.password_hash.is_not(None))
    )
    return (result.scalar_one() or 0) > 0


@router.post("/register", response_model=AuthEnvelope, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthEnvelope:
    username = body.username.lower()
    if await _get_by_username(db, username) is not None:
        raise_http(status.HTTP_409_CONFLICT, ErrorCode.USERNAME_TAKEN, "Username taken")

    first = not await _any_claimed_user(db)
    if first:
        # First registration claims the unclaimed default user (keeps its annotations).
        user = await _unclaimed_default(db)
        if user is None:
            user = User(name=username)
            db.add(user)
        user.username = username
        user.password_hash = hash_password(body.password)
        user.is_admin = True
    else:
        user = User(name=username, username=username, password_hash=hash_password(body.password))
        db.add(user)
    await db.flush()

    session = await create_session(db, user.id)
    set_session_cookie(response, session.token)
    return AuthEnvelope(user=UserResponse.model_validate(user))


@router.post("/login", response_model=AuthEnvelope)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthEnvelope:
    user = await _get_by_username(db, body.username.lower())
    # Same response whether the user is unknown or the password is wrong (timing-safe-ish).
    if (
        user is None
        or user.password_hash is None
        or not verify_password(body.password, user.password_hash)
    ):
        raise_http(401, ErrorCode.INVALID_CREDENTIALS, "Invalid username or password")

    await cleanup_expired_sessions(db, user.id)
    session = await create_session(db, user.id)
    set_session_cookie(response, session.token)
    return AuthEnvelope(user=UserResponse.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await delete_session(db, token)
    clear_session_cookie(response)


@router.get("/me", response_model=AuthEnvelope)
async def me(user: User = Depends(get_current_user)) -> AuthEnvelope:
    return AuthEnvelope(user=UserResponse.model_validate(user))
