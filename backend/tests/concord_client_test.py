"""Unit tests for the Concord client's error mapping, using httpx's built-in MockTransport
(no live Concord, no network)."""

import httpx
import pytest
from songbird.concord.client import ConcordClient, ConcordUnreachableError


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
