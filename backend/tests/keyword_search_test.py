"""Keyword (exact word/phrase) Scripture search proxy (issue #46). A thin proxy of Concord's
`/v1/search` — the literal-text counterpart to semantic search, with no ranking score."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import KeywordResult, KeywordSearchResponse
from tests.conftest import FakeConcordClient


def _results() -> KeywordSearchResponse:
    return KeywordSearchResponse(
        hits=[
            KeywordResult(
                book="JHN",
                chapter=11,
                verse=35,
                reference="John 11:35",
                snippet="Jesus <mark>wept</mark>.",
            ),
            KeywordResult(
                book="LUK",
                chapter=19,
                verse=41,
                reference="Luke 19:41",
                snippet="...he beheld the city, and <mark>wept</mark> over it,",
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
    # Exact-match rows carry the canonical anchor + the highlight snippet, and NO score/text fields
    # (keyword ≠ ranked; the verse arrives as `snippet` with <mark> around the match).
    assert rows[0] == {
        "book": "JHN",
        "chapter": 11,
        "verse": 35,
        "reference": "John 11:35",
        "snippet": "Jesus <mark>wept</mark>.",
    }
    assert all("score" not in r and "text" not in r for r in rows)


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


async def test_keyword_search_unrunnable_query_is_no_results(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Concord's FTS5 keyword search 400s on ordinary punctuation (e.g. "God's love"), which the
    # client surfaces as ConcordNotFoundError. That's not an outage — present it as "no results"
    # (issue #51), so the UI shows a lack of matches and offers semantic, not a scary error.
    async with client_for(
        make_concord(error=ConcordNotFoundError("Concord could not run that search: 400"))
    ) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "God's love"})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_keyword_search_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "wept"})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
