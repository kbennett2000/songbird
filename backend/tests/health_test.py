from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import ConcordHealth
from tests.conftest import FakeConcordClient


async def test_app_boots_healthz_ok(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(health=ConcordHealth(status="ok", translation_count=13))
    async with client_for(concord) as client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200


async def test_healthz_shape_concord_up(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(
        health=ConcordHealth(status="ok", translation_count=13),
        base_url="http://concord.test",
    )
    async with client_for(concord) as client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)
    assert body["concord"] == {
        "base_url": "http://concord.test",
        "reachable": True,
        "status": "ok",
        "translation_count": 13,
        "error": None,
    }


async def test_healthz_concord_unreachable(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    concord = make_concord(error=err, base_url="http://concord.test")
    async with client_for(concord) as client:
        resp = await client.get("/healthz")
    # songbird stays alive (200) and reports the dependency as down in the body.
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["concord"]["reachable"] is False
    assert body["concord"]["status"] is None
    assert body["concord"]["translation_count"] is None
    assert body["concord"]["error"]
