"""Session cookie config (mirrors soap-journal). The cookie holds a random DB session token —
no signing secret needed. `secure=False` because the single-unit deploy is typically LAN HTTP."""

from fastapi import Response

COOKIE_NAME = "songbird_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
COOKIE_PATH = "/"


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        path=COOKIE_PATH,
        httponly=True,
        secure=False,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path=COOKIE_PATH)
