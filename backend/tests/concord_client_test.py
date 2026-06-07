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


async def test_keyword_search_hits_v1_search_and_parses() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["q"] = request.url.params.get("q", "")
        seen["translation"] = request.url.params.get("translation", "")
        seen["limit"] = request.url.params.get("limit", "")
        # The real Concord /v1/search body: a `hits` array whose items carry a `snippet` with the
        # matched term wrapped in <mark>…</mark> (captured live from Concord 192.168.1.62:8000).
        return httpx.Response(
            200,
            json={
                "query": "living water",
                "translation": "KJV",
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
                    }
                ],
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    result = await client.keyword_search("living water", "KJV", limit=5)
    await client.aclose()
    assert seen == {
        "path": "/v1/search",
        "q": "living water",
        "translation": "KJV",
        "limit": "5",
    }
    assert result.hits[0].book == "JHN"
    assert result.hits[0].snippet is not None
    assert "<mark>living</mark>" in result.hits[0].snippet


async def test_keyword_search_404_is_not_found() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "unknown_translation"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ConcordNotFoundError):
        await client.keyword_search("peace", "ZZZ")
    await client.aclose()


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
