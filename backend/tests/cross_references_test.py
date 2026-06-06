"""The cross-references proxy: songbird passes Concord's TSK data through as canonical coords,
preserving the 404 (bad reference) vs 502 (unreachable) split. songbird stores none of it."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import CrossRefEntry, CrossRefResponse, CrossRefTarget
from tests.conftest import FakeConcordClient


def _refs() -> CrossRefResponse:
    return CrossRefResponse(
        cross_references=[
            CrossRefEntry(
                to=CrossRefTarget(
                    book="ROM",
                    chapter=5,
                    verse_start=8,
                    verse_end=None,
                    reference="Romans 5:8",
                ),
                votes=968,
                text="But God commendeth his love...",
            ),
            CrossRefEntry(
                to=CrossRefTarget(
                    book="1JN",
                    chapter=4,
                    verse_start=9,
                    verse_end=10,
                    reference="1 John 4:9-10",
                ),
                votes=684,
                text=None,
            ),
        ]
    )


async def test_cross_references_mapped(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(cross_refs=_refs())) as client:
        resp = await client.get("/api/v1/cross-references/JHN/3/16", params={"translation": "KJV"})
    assert resp.status_code == 200
    rows = resp.json()
    assert rows[0] == {
        "book": "ROM",
        "chapter": 5,
        "verse_start": 8,
        "verse_end": None,
        "reference": "Romans 5:8",
        "votes": 968,
        "text": "But God commendeth his love...",
    }
    # Range target preserves verse_end.
    assert rows[1]["verse_end"] == 10


async def test_cross_references_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(cross_refs=CrossRefResponse(cross_references=[]))) as client:
        resp = await client.get("/api/v1/cross-references/PHM/1/1")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_cross_references_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("bad ref"))) as client:
        resp = await client.get("/api/v1/cross-references/JHN/3/999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_cross_references_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/cross-references/JHN/3/16")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
