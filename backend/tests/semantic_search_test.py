"""Semantic Scripture search proxy. songbird runs no ML — it calls Concord and renders ranked
results; the heaviest capability is the thinnest call."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import SemanticResult, SemanticSearchResponse
from tests.conftest import FakeConcordClient


def _results() -> SemanticSearchResponse:
    return SemanticSearchResponse(
        results=[
            SemanticResult(
                book="PRO",
                chapter=12,
                verse=25,
                reference="Proverbs 12:25",
                score=0.8952,
                text="Heaviness in the heart of man maketh it stoop...",
            ),
            SemanticResult(
                book="PSA",
                chapter=55,
                verse=5,
                reference="Psalms 55:5",
                score=0.8823,
                text="Fearfulness and trembling are come upon me...",
            ),
        ]
    )


async def test_semantic_search_ranked(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(semantic=_results())) as client:
        resp = await client.get("/api/v1/semantic-search", params={"q": "anxiety", "limit": 2})
    assert resp.status_code == 200
    rows = resp.json()
    assert rows[0] == {
        "book": "PRO",
        "chapter": 12,
        "verse": 25,
        "reference": "Proverbs 12:25",
        "score": 0.8952,
        "text": "Heaviness in the heart of man maketh it stoop...",
    }
    # Concord's ranking (score desc) is preserved.
    assert [r["score"] for r in rows] == sorted((r["score"] for r in rows), reverse=True)


async def test_semantic_search_empty_query_makes_no_call(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A fake that raises on any call — an empty query must short-circuit to [] without calling.
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/semantic-search", params={"q": "   "})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_semantic_search_unknown_translation_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(
        make_concord(error=ConcordNotFoundError("unknown translation"))
    ) as client:
        resp = await client.get(
            "/api/v1/semantic-search", params={"q": "peace", "translation": "ZZZ"}
        )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_semantic_search_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/semantic-search", params={"q": "anxiety"})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
