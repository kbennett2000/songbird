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


async def test_me_last_position_defaults_null(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A fresh user has no remembered position — the reader falls back to its default chapter.
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        me = await client.get("/api/v1/auth/me")
    body = me.json()["user"]
    assert body["last_book"] is None
    assert body["last_chapter"] is None


async def test_patch_me_sets_full_position(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        # Whole position in one PATCH; codes normalize upper-case (canonical like "WEB"/"GEN").
        patch = await client.patch(
            "/api/v1/auth/me",
            json={"last_translation": "web", "last_book": "gen", "last_chapter": 5},
        )
        assert patch.status_code == 200
        assert patch.json()["user"]["last_translation"] == "WEB"
        assert patch.json()["user"]["last_book"] == "GEN"
        assert patch.json()["user"]["last_chapter"] == 5
        # Persisted across a round-trip.
        me = await client.get("/api/v1/auth/me")
    user = me.json()["user"]
    assert (user["last_translation"], user["last_book"], user["last_chapter"]) == ("WEB", "GEN", 5)


async def test_patch_me_partial_only_applies_provided(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A partial patch must not clobber unsent fields — saving the chapter alone keeps the rest.
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        await client.patch(
            "/api/v1/auth/me",
            json={"last_translation": "WEB", "last_book": "JHN", "last_chapter": 3},
        )
        patch = await client.patch("/api/v1/auth/me", json={"last_chapter": 7})
        assert patch.status_code == 200
        user = patch.json()["user"]
    assert (user["last_translation"], user["last_book"], user["last_chapter"]) == ("WEB", "JHN", 7)


async def test_patch_me_rejects_chapter_below_one(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(make_concord()) as client:
        await client.post("/api/v1/auth/register", json=CREDS)
        resp = await client.patch("/api/v1/auth/me", json={"last_chapter": 0})
    assert resp.status_code == 422


def test_argon2_hash_verifies() -> None:
    hashed = hash_password("supersecret")
    assert hashed != "supersecret"
    assert hashed.startswith("$argon2")
    assert verify_password("supersecret", hashed) is True
    assert verify_password("wrong", hashed) is False
