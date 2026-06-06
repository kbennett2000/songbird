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
