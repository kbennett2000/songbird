"""Session cookie flags honor COOKIE_SECURE: the `Secure` attribute is present when
secure=True (TLS deploy) and absent when secure=False (the LAN-HTTP default), while the
constant hardening (HttpOnly, SameSite=Lax) stays put either way."""

from fastapi import Response
from songbird.config import Settings
from songbird.core.cookies import COOKIE_NAME, set_session_cookie


def _set_cookie_header(*, secure: bool) -> str:
    response = Response()
    set_session_cookie(response, "a-session-token", secure=secure)
    return response.headers["set-cookie"]


def test_secure_true_emits_secure_flag() -> None:
    header = _set_cookie_header(secure=True)
    assert COOKIE_NAME in header
    assert "Secure" in header
    # Constant hardening is unaffected by the toggle.
    assert "HttpOnly" in header
    assert "samesite=lax" in header.lower()


def test_secure_false_omits_secure_flag() -> None:
    header = _set_cookie_header(secure=False)
    assert COOKIE_NAME in header
    assert "secure" not in header.lower()
    # Still hardened even without TLS.
    assert "HttpOnly" in header
    assert "samesite=lax" in header.lower()


def test_cookie_secure_default_is_false() -> None:
    # The safe default: no Secure flag unless a deployment explicitly opts in for TLS.
    assert Settings.model_fields["cookie_secure"].default is False
