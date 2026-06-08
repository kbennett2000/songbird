"""Unit tests for the Concord client's error mapping, using httpx's built-in MockTransport
(no live Concord, no network)."""

import httpx
import pytest
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)


def _chapter_json() -> dict[str, object]:
    return {
        "reference": "John 3",
        "translations": ["KJV"],
        "verses": [
            {
                "book": "JHN",
                "chapter": 3,
                "verse": 16,
                "reference": "John 3:16",
                "text": {"KJV": "For God so loved the world..."},
            }
        ],
    }


async def test_client_maps_connect_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.health()
    await client.aclose()


async def test_client_maps_error_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.list_translations()
    await client.aclose()


async def test_client_parses_translations() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "translations": [
                    {
                        "id": "KJV",
                        "name": "King James Version",
                        "language": "en",
                        "versification": "standard",
                        "attribution": None,
                    }
                ]
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    translations = await client.list_translations()
    await client.aclose()
    assert translations[0].id == "KJV"
    assert translations[0].name == "King James Version"


async def test_get_chapter_parses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chapter_json())

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    chapter = await client.get_chapter("JHN", 3, "KJV")
    await client.aclose()
    assert chapter.verses[0].book == "JHN"
    assert chapter.verses[0].verse == 16
    assert chapter.verses[0].text["KJV"].startswith("For God")


async def test_get_chapter_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_book"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.get_chapter("XXX", 3, "KJV")
    await client.aclose()


async def test_get_chapter_5xx_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.get_chapter("JHN", 3, "KJV")
    await client.aclose()


async def test_get_chapter_transport_error_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.get_chapter("JHN", 3, "KJV")
    await client.aclose()


async def test_resolve_reference_parses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_chapter_json())

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    chapter = await client.resolve_reference("John 3:16")
    await client.aclose()
    assert chapter.verses[0].book == "JHN"
    assert chapter.verses[0].chapter == 3


async def test_resolve_reference_400_is_not_found() -> None:
    # Concord returns 400 for an unparseable reference — a "couldn't find it", not unreachable.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"code": "unparseable_reference"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.resolve_reference("asdfqwer")
    await client.aclose()


async def test_resolve_reference_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_book"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.resolve_reference("Hesitations 3")
    await client.aclose()


async def test_resolve_reference_5xx_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.resolve_reference("John 3")
    await client.aclose()


async def test_resolve_reference_transport_error_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.resolve_reference("John 3")
    await client.aclose()


def _cross_refs_json() -> dict[str, object]:
    return {
        "reference": "John 3:16",
        "total": 1,
        "cross_references": [
            {
                "from": {"book": "JHN", "chapter": 3, "verse": 16, "reference": "John 3:16"},
                "to": {
                    "book": "ROM",
                    "chapter": 5,
                    "verse_start": 8,
                    "verse_end": None,
                    "reference": "Romans 5:8",
                },
                "votes": 968,
                "text": "But God commendeth his love...",
            }
        ],
    }


async def test_get_cross_references_parses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_cross_refs_json())

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.get_cross_references("JHN", 3, 16, "KJV")
    await client.aclose()
    assert result.cross_references[0].to.book == "ROM"
    assert result.cross_references[0].to.verse_start == 8
    assert result.cross_references[0].votes == 968


async def test_get_cross_references_400_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"code": "unparseable_reference"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.get_cross_references("XXX", 3, 16)
    await client.aclose()


async def test_get_cross_references_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "no_verses_found"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.get_cross_references("JHN", 3, 999)
    await client.aclose()


async def test_get_cross_references_5xx_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.get_cross_references("JHN", 3, 16)
    await client.aclose()


def _semantic_json() -> dict[str, object]:
    return {
        "query": "anxiety",
        "translation": "KJV",
        "count": 1,
        "results": [
            {
                "book": "PRO",
                "chapter": 12,
                "verse": 25,
                "reference": "Proverbs 12:25",
                "score": 0.8952,
                "text": "Heaviness in the heart of man...",
            }
        ],
    }


def _places_json() -> dict[str, object]:
    return {
        "reference": "Genesis 4",
        "total": 1,
        "places": [
            {
                "id": "a1ad8e1",
                "friendly_id": "Nod",
                "name": "Land of Nod",
                "type": "region",
                "latitude": None,
                "longitude": None,
                "confidence": None,
                "confidence_score": None,
                "status": "unknown",
            }
        ],
    }


async def test_semantic_search_parses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_semantic_json())

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.semantic_search("anxiety", "KJV", 1)
    await client.aclose()
    assert result.results[0].book == "PRO"
    assert result.results[0].score == 0.8952


async def test_semantic_search_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_translation"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.semantic_search("peace", "ZZZ")
    await client.aclose()


async def test_keyword_search_all_translations_sends_star_and_parses_matches() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["q"] = request.url.params.get("q", "")
        # No `translations` arg → the client searches all loaded translations (`*`); the old
        # singular `translation` param is gone.
        seen["translations"] = request.url.params.get("translations", "")
        seen["translation"] = request.url.params.get("translation", "<absent>")
        seen["limit"] = request.url.params.get("limit", "")
        # The real multi-translation /v1/search body: each hit carries a flat top-ranked `snippet`
        # plus a `matches` map (translation id → snippet, top-ranked first) and the response echoes
        # the `translations` searched (captured live from Concord v1.1.0).
        return httpx.Response(
            200,
            json={
                "query": "living water",
                "translation": "KJV",
                "translations": ["KJV", "WEB"],
                "book": None,
                "limit": 5,
                "offset": 0,
                "total": 7,
                "hits": [
                    {
                        "book": "JHN",
                        "chapter": 7,
                        "verse": 38,
                        "reference": "John 7:38",
                        "snippet": "rivers of <mark>living</mark> <mark>water</mark>.",
                        "matches": {
                            "KJV": "rivers of <mark>living</mark> <mark>water</mark>.",
                            "WEB": "rivers of <mark>living</mark> <mark>water</mark>.",
                        },
                    }
                ],
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.keyword_search("living water", None, limit=5)
    await client.aclose()
    assert seen == {
        "path": "/v1/search",
        "q": "living water",
        "translations": "*",
        "translation": "<absent>",
        "limit": "5",
    }
    assert result.hits[0].book == "JHN"
    assert result.hits[0].snippet is not None
    assert "<mark>living</mark>" in result.hits[0].snippet
    assert result.hits[0].matches == {
        "KJV": "rivers of <mark>living</mark> <mark>water</mark>.",
        "WEB": "rivers of <mark>living</mark> <mark>water</mark>.",
    }
    assert result.translations == ["KJV", "WEB"]


async def test_keyword_search_narrowed_sends_csv() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["translations"] = request.url.params.get("translations", "")
        return httpx.Response(200, json={"hits": []})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    await client.keyword_search("living water", ["KJV", "WEB"], limit=5)
    await client.aclose()
    assert seen["translations"] == "KJV,WEB"


async def test_keyword_search_uses_a_generous_read_timeout() -> None:
    # Concord's keyword search can take 6–8s cold; the read budget must exceed the client's default
    # 5s so a *slow* search isn't misreported as an outage, while connect stays tight (fail fast if
    # Concord is genuinely down). Guards the fix for the single-translation 502 regression.
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["timeout"] = request.extensions.get("timeout")
        return httpx.Response(200, json={"hits": []})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    await client.keyword_search("living water", ["KJV"], limit=5)
    await client.aclose()
    timeout = seen["timeout"]
    assert isinstance(timeout, dict)
    assert timeout["read"] == 30.0
    assert timeout["connect"] == 5.0


async def test_keyword_search_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_translation"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.keyword_search("peace", ["ZZZ"])
    await client.aclose()


async def test_search_notes_hits_v1_notes_search_and_parses() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["q"] = request.url.params.get("q", "")
        seen["timeout"] = request.extensions.get("timeout")
        # The real Concord /v1/notes/search body: a `hits` array of notes with canonical coords, a
        # `translation`, a `type`, and a `snippet` with the match wrapped in <mark>…</mark>.
        return httpx.Response(
            200,
            json={
                "query": "love",
                "total": 1,
                "hits": [
                    {
                        "book": "JHN",
                        "chapter": 3,
                        "verse": 16,
                        "reference": "John 3:16",
                        "translation": "NET",
                        "type": "sn",
                        "char_offset": 19,
                        "marker": "7",
                        "ordinal": 0,
                        "snippet": "The word for <mark>love</mark> is ἀγάπη.",
                    }
                ],
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.search_notes("love")
    await client.aclose()
    assert seen["path"] == "/v1/notes/search"
    assert seen["q"] == "love"
    # Rides the same generous read budget as keyword search (notes search can be slow too).
    timeout = seen["timeout"]
    assert isinstance(timeout, dict)
    assert timeout["read"] == 30.0
    assert timeout["connect"] == 5.0
    hit = result.hits[0]
    assert (hit.book, hit.chapter, hit.verse, hit.translation, hit.type) == (
        "JHN",
        3,
        16,
        "NET",
        "sn",
    )
    assert hit.snippet is not None and "<mark>love</mark>" in hit.snippet


async def test_semantic_search_422_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "bad query"})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.semantic_search("")
    await client.aclose()


async def test_semantic_search_5xx_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.semantic_search("anxiety")
    await client.aclose()


async def test_get_places_parses_and_preserves_nulls() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_places_json())

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.get_places("GEN", 4)
    await client.aclose()
    assert result.places[0].friendly_id == "Nod"
    assert result.places[0].status == "unknown"
    assert result.places[0].latitude is None
    assert result.places[0].confidence is None


async def test_get_places_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_book"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.get_places("XXX", 1)
    await client.aclose()


async def test_get_places_5xx_is_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordUnreachableError):
        await client.get_places("GEN", 2)
    await client.aclose()


async def test_get_place_verses_parses() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "af3daeb",
                "total": 1,
                "verses": [{"book": "GEN", "chapter": 2, "verse": 8, "reference": "Genesis 2:8"}],
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.get_place_verses("af3daeb")
    await client.aclose()
    assert result.verses[0].book == "GEN"
    assert result.verses[0].verse == 8


async def test_get_place_verses_unknown_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_place"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.get_place_verses("does-not-exist")
    await client.aclose()


async def test_list_places_sends_filters_and_parses_page() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        for k in ("type", "status", "q", "limit", "offset"):
            seen[k] = request.url.params.get(k, "")
        return httpx.Response(
            200,
            json={
                "total": 1340,
                "places": [
                    {
                        "id": "a15257a",
                        "friendly_id": "Jerusalem",
                        "name": "Jerusalem",
                        "type": "settlement",
                        "latitude": 31.78,
                        "longitude": 35.23,
                        "confidence": "high",
                        "confidence_score": 90,
                        "status": "identified",
                    }
                ],
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    page = await client.list_places(type="settlement", status="identified", q="jer", limit=25, offset=50)
    await client.aclose()
    assert seen == {
        "path": "/v1/places",
        "type": "settlement",
        "status": "identified",
        "q": "jer",
        "limit": "25",
        "offset": "50",
    }
    assert page.total == 1340
    assert page.places[0].name == "Jerusalem"


async def test_get_place_parses_detail_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/places/a15257a"
        return httpx.Response(
            200,
            json={
                "id": "a15257a",
                "friendly_id": "Jerusalem",
                "name": "Jerusalem",
                "url_slug": "jerusalem",
                "type": "settlement",
                "preceding_article": None,
                "latitude": 31.78,
                "longitude": 35.23,
                "confidence": "high",
                "confidence_score": 90,
                "status": "identified",
                "modern_name": "Jerusalem, Israel",
                "verse_count": 800,
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    detail = await client.get_place("a15257a")
    await client.aclose()
    assert detail.modern_name == "Jerusalem, Israel"
    assert detail.verse_count == 800


async def test_list_place_types_parses_available_from_unknown_type_error() -> None:
    # Concord rejects an unknown `type` with the full vocabulary in error.detail.available — we read
    # it rather than hardcoding a list that goes stale (verified live against v1.1.0).
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "error": {
                    "code": "unknown_type",
                    "message": "unknown place type '__songbird_probe__'",
                    "detail": {"type": "__songbird_probe__", "available": ["altar", "settlement"]},
                }
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    types = await client.list_place_types()
    await client.aclose()
    assert types == ["altar", "settlement"]


async def test_list_place_types_empty_when_not_surfaced() -> None:
    # Graceful fallback: a 200 (no error body) or a malformed error → [] (the UI hides the filter).
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"total": 0, "places": []})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    assert await client.list_place_types() == []
    await client.aclose()
