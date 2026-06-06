"""Gating: every data route requires a logged-in user (401 without a cookie); only `/healthz`
and `/api/v1/auth/*` are open. Uses `unauth_client` (real `get_current_user`)."""

from collections.abc import Callable

import httpx
from songbird.concord.schemas import ConcordHealth
from tests.conftest import FakeConcordClient
from tests.helpers import DEFAULT_TRANSLATIONS, build_chapter

GATED_PATHS = [
    "/api/v1/read/KJV/JHN/3",
    "/api/v1/annotations",
    "/api/v1/tags",
    "/api/v1/translations",
    "/api/v1/places?book=JHN&chapter=3",
    "/api/v1/semantic-search?q=love",
]


async def test_gated_routes_require_auth(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(
        translations=DEFAULT_TRANSLATIONS, chapter=build_chapter("JHN", 3, "KJV")
    )
    async with unauth_client(concord) as client:
        for path in GATED_PATHS:
            resp = await client.get(path)
            assert resp.status_code == 401, f"{path} should be gated"
            assert resp.json()["detail"]["code"] == "NOT_AUTHENTICATED"


async def test_healthz_is_open(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(health=ConcordHealth(status="ok", translation_count=13))
    async with unauth_client(concord) as client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200


async def test_auth_routes_are_open(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Reachable without a cookie: register returns 201 rather than 401.
    async with unauth_client(make_concord()) as client:
        resp = await client.post(
            "/api/v1/auth/register", json={"username": "open", "password": "password1"}
        )
    assert resp.status_code == 201
