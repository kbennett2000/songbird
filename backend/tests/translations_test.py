from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import Translation
from tests.conftest import FakeConcordClient


async def test_translations_proxy_ok(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(
        translations=[
            Translation(
                id="KJV",
                name="King James Version",
                language="en",
                versification="standard",
                attribution=None,
            )
        ]
    )
    async with client_for(concord) as client:
        resp = await client.get("/api/v1/translations")
    assert resp.status_code == 200
    body = resp.json()
    assert body["translations"][0]["id"] == "KJV"


async def test_translations_concord_unreachable(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    concord = make_concord(error=err)
    async with client_for(concord) as client:
        resp = await client.get("/api/v1/translations")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
