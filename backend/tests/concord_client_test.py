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
