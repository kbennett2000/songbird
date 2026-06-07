"""Auth round-trip: register (claims the default user), login, me, logout — Argon2
cookie-session. Uses `unauth_client` so the real `get_current_user` + cookie jar are exercised."""

from collections.abc import Callable

import httpx
from songbird.core.cookies import COOKIE_NAME
from songbird.core.passwords import hash_password, verify_password
from tests.conftest import FakeConcordClient

CREDS = {"username": "kris", "password": "supersecret"}


async def test_register_claims_default_user_and_is_admin(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        resp = await client.post("/api/v1/auth/register", json=CREDS)
        assert resp.status_code == 201
        user = resp.json()["user"]
        # The seeded default user (id=1) is claimed, not a new row.
        assert user["id"] == 1
        assert user["username"] == "kris"
        assert user["is_admin"] is True
        assert COOKIE_NAME in resp.cookies


async def test_register_rejects_duplicate_username(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        first = await client.post("/api/v1/auth/register", json=CREDS)
        assert first.status_code == 201
        # Different cased same name (usernames are lowercased) → conflict.
        dup = await client.post(
            "/api/v1/auth/register", json={"username": "KRIS", "password": "another1"}
        )
    assert dup.status_code == 409
    assert dup.json()["detail"]["code"] == "USERNAME_TAKEN"


async def test_second_user_is_not_admin(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as a:
        await a.post("/api/v1/auth/register", json=CREDS)
    async with unauth_client(make_concord()) as b:
        resp = await b.post(
            "/api/v1/auth/register", json={"username": "second", "password": "password2"}
        )
    assert resp.status_code == 201
    user = resp.json()["user"]
    assert user["id"] != 1
    assert user["is_admin"] is False


async def test_login_ok_and_me(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        # Logging in afresh issues a new session cookie.
        login = await client.post("/api/v1/auth/login", json=CREDS)
        assert login.status_code == 200
        assert login.json()["user"]["username"] == "kris"

        me = await client.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["user"]["username"] == "kris"


async def test_login_wrong_password_401(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        resp = await client.post(
            "/api/v1/auth/login", json={"username": "kris", "password": "wrongpass"}
        )
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "INVALID_CREDENTIALS"


async def test_login_unknown_user_401_same_shape(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        resp = await client.post(
            "/api/v1/auth/login", json={"username": "nobody", "password": "whatever1"}
        )
    # Same code as a wrong password — no user-existence leak.
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "INVALID_CREDENTIALS"


async def test_me_without_cookie_401(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "NOT_AUTHENTICATED"


async def test_logout_revokes_session(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        assert (await client.get("/api/v1/auth/me")).status_code == 200

        logout = await client.post("/api/v1/auth/logout")
        assert logout.status_code == 204

        # Cookie cleared + session deleted server-side → me is now 401.
        me = await client.get("/api/v1/auth/me")
    assert me.status_code == 401


async def test_me_last_translation_defaults_null(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A fresh user has no remembered translation — the reader falls back to its default.
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["last_translation"] is None


async def test_patch_me_sets_last_translation_normalized(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        # Lower-case in → stored upper-case (codes are canonical like "WEB").
        patch = await client.patch("/api/v1/auth/me", json={"last_translation": "web"})
        assert patch.status_code == 200
        assert patch.json()["user"]["last_translation"] == "WEB"
        # Persisted: the next /me round-trip reflects it.
        me = await client.get("/api/v1/auth/me")
    assert me.json()["user"]["last_translation"] == "WEB"


async def test_patch_me_without_cookie_401(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        resp = await client.patch("/api/v1/auth/me", json={"last_translation": "WEB"})
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "NOT_AUTHENTICATED"


async def test_login_lockout_after_repeated_failures(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        # The default throttle locks after 5 failures; each of these is a normal 401.
        for _ in range(5):
            bad = await client.post(
                "/api/v1/auth/login", json={"username": "kris", "password": "wrongpass"}
            )
            assert bad.status_code == 401
        # The next attempt is locked out — even with the *correct* password.
        locked = await client.post("/api/v1/auth/login", json=CREDS)
        assert locked.status_code == 429
        assert locked.json()["detail"]["code"] == "TOO_MANY_ATTEMPTS"


async def test_login_lockout_is_per_username(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        for _ in range(5):
            await client.post(
                "/api/v1/auth/login", json={"username": "kris", "password": "wrongpass"}
            )
        assert (await client.post("/api/v1/auth/login", json=CREDS)).status_code == 429
        # A different username from the same client is still just invalid creds, not locked.
        other = await client.post(
            "/api/v1/auth/login", json={"username": "ghost", "password": "whatever1"}
        )
    assert other.status_code == 401
    assert other.json()["detail"]["code"] == "INVALID_CREDENTIALS"


async def test_successful_login_clears_throttle(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        # Four failures stay under the limit; a success then clears the counter.
        for _ in range(4):
            assert (
                await client.post(
                    "/api/v1/auth/login", json={"username": "kris", "password": "wrongpass"}
                )
            ).status_code == 401
        assert (await client.post("/api/v1/auth/login", json=CREDS)).status_code == 200
        # Without the reset, four more failures would trip the limit; because success cleared
        # it, they are all still plain 401s.
        for _ in range(4):
            assert (
                await client.post(
                    "/api/v1/auth/login", json={"username": "kris", "password": "wrongpass"}
                )
            ).status_code == 401


def test_argon2_hash_verifies() -> None:
    hashed = hash_password("supersecret")
    assert hashed != "supersecret"
    assert hashed.startswith("$argon2")
    assert verify_password("supersecret", hashed) is True
    assert verify_password("wrong", hashed) is False
