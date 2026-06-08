"""Keyword (exact word/phrase) Scripture search proxy (issue #46). A thin proxy of Concord's
`/v1/search` — the literal-text counterpart to semantic search, with no ranking score. Multi-
translation: searches all loaded translations by default, narrowable to a subset, with a per-
translation `matches` map on each hit (v1.3 Slice 1)."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import KeywordResult, KeywordSearchResponse
from tests.conftest import FakeConcordClient


def _results() -> KeywordSearchResponse:
    # A multi-translation hit (matched in two translations) and a single-match hit (matches None).
    return KeywordSearchResponse(
        hits=[
            KeywordResult(
                book="JHN",
                chapter=11,
                verse=35,
                reference="John 11:35",
                snippet="Jesus <mark>wept</mark>.",
                matches={
                    "KJV": "Jesus <mark>wept</mark>.",
                    "WEB": "Jesus <mark>wept</mark>.",
                },
            ),
            KeywordResult(
                book="LUK",
                chapter=19,
                verse=41,
                reference="Luke 19:41",
                snippet="...he beheld the city, and <mark>wept</mark> over it,",
            ),
        ],
        translations=["KJV", "WEB"],
    )


async def test_keyword_search_returns_matches(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(keyword=_results())
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "wept", "limit": 2})
    assert resp.status_code == 200
    rows = resp.json()
    # Each row carries the canonical anchor, the flat highlight `snippet`, and the per-translation
    # `matches` map (null when the verse matched in just one translation). No score/text fields
    # (keyword ≠ ranked).
    assert rows[0] == {
        "book": "JHN",
        "chapter": 11,
        "verse": 35,
        "reference": "John 11:35",
        "snippet": "Jesus <mark>wept</mark>.",
        "matches": {"KJV": "Jesus <mark>wept</mark>.", "WEB": "Jesus <mark>wept</mark>."},
    }
    assert rows[1]["matches"] is None
    assert all("score" not in r and "text" not in r for r in rows)


async def test_keyword_search_all_translations_by_default(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # No `translations` param → the endpoint passes None to the client, which searches all (`*`).
    fake = make_concord(keyword=_results())
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/keyword-search", params={"q": "wept"})
    assert resp.status_code == 200
    assert fake.last_keyword_translations is None


async def test_keyword_search_narrows_to_a_subset(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A CSV `translations` param is parsed to a list and forwarded to the client.
    fake = make_concord(keyword=_results())
    async with client_for(fake) as client:
        resp = await client.get(
            "/api/v1/keyword-search", params={"q": "wept", "translations": "KJV,WEB"}
        )
    assert resp.status_code == 200
    assert fake.last_keyword_translations == ["KJV", "WEB"]


async def test_keyword_search_single_translation_narrowing(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(keyword=_results())
    async with client_for(fake) as client:
        resp = await client.get(
            "/api/v1/keyword-search", params={"q": "wept", "translations": "KJV"}
        )
    assert resp.status_code == 200
    assert fake.last_keyword_translations == ["KJV"]


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
