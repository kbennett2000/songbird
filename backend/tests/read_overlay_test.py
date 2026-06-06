from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from tests.conftest import FakeConcordClient
from tests.helpers import ANNOTATION_BODY, build_chapter


async def test_read_returns_verses_with_overlay(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(chapter=build_chapter("JHN", 3, "KJV", verses=20))
    async with client_for(concord) as client:
        created = await client.post("/api/v1/annotations", json=ANNOTATION_BODY)
        assert created.status_code == 201
        annotation_id = created.json()["id"]

        resp = await client.get("/api/v1/read/KJV/JHN/3")
    assert resp.status_code == 200
    data = resp.json()
    assert data["book"] == "JHN"
    assert data["translation"] == "KJV"
    assert len(data["verses"]) == 20

    by_verse = {v["verse"]: v for v in data["verses"]}
    assert by_verse[16]["text"] is not None
    # The annotation lands on verse 16 only.
    assert [a["id"] for a in by_verse[16]["annotations"]] == [annotation_id]
    assert by_verse[15]["annotations"] == []
    assert by_verse[17]["annotations"] == []


async def test_read_concord_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/read/KJV/JHN/3")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_read_concord_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("no such chapter"))) as client:
        resp = await client.get("/api/v1/read/KJV/JHN/999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"
