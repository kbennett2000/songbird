"""Keyword (exact word/phrase) Scripture search proxy (issue #46). A thin proxy of Concord's
`/v1/search` — the literal-text counterpart to semantic search, with no ranking score."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import KeywordResult, KeywordSearchResponse
from tests.conftest import FakeConcordClient


def _results() -> KeywordSearchResponse:
    return KeywordSearchResponse(
        results=[
            KeywordResult(
                book="JHN",
                chapter=11,
                verse=35,
                reference="John 11:35",
                text="Jesus wept.",
            ),
            KeywordResult(
                book="LUK",
                chapter=19,
                verse=41,
                reference="Luke 19:41",
                text="And when he was come near, he beheld the city, and wept over it,",
            ),
        ]
    )


async def test_keyword_search_returns_matches(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(keyword=_results())) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "wept", "limit": 2})
    assert resp.status_code == 200
    rows = resp.json()
    # Exact-match rows carry the canonical anchor + text, and crucially NO score (keyword ≠ ranked).
    assert rows[0] == {
        "book": "JHN",
        "chapter": 11,
        "verse": 35,
        "reference": "John 11:35",
        "text": "Jesus wept.",
    }
    assert all("score" not in r for r in rows)


async def test_keyword_search_empty_query_makes_no_call(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A fake that raises on any call — an empty query must short-circuit to [] without calling.
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "   "})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_keyword_search_unknown_translation_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(
        make_concord(error=ConcordNotFoundError("unknown translation"))
    ) as client:
        resp = await client.get(
            "/api/v1/keyword-search", params={"q": "wept", "translation": "ZZZ"}
        )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_keyword_search_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "wept"})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
