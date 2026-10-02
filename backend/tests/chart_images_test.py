"""A chart's picture, passed through from Concord (v1.8 slice B; Concord ADR-0012).

`GET /api/v1/translations/{translation}/assets/{name}` relays one of a translation's images at
request time — songbird stores none (invariants 1 and 5). Made-up bytes and names only: never a
real study Bible's picture.
"""

from collections.abc import Callable

import httpx
import pytest
from songbird.concord.client import ConcordAsset, ConcordClient, ConcordUnreachableError
from tests.conftest import FakeConcordClient

_BYTES = b"\x89PNG\r\n\x1a\n made-up picture bytes"
_ETAG = '"made-up-etag"'
_CONCORD_CACHE = "public, max-age=31536000, immutable"


def _asset(**overrides: object) -> ConcordAsset:
    fields: dict[str, object] = {
        "not_modified": False,
        "content": _BYTES,
        "media_type": "image/png",
        "etag": _ETAG,
        "cache_control": _CONCORD_CACHE,
        "vary": "Origin",
        **overrides,
    }
    return ConcordAsset(**fields)  # type: ignore[arg-type]


_URL = "/api/v1/translations/EMB/assets/chart-99.png"


# --- The route ---


async def test_a_picture_passes_through_with_its_caching_made_private(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(asset=_asset())
    async with client_for(fake) as client:
        response = await client.get(_URL)
    assert response.status_code == 200
    assert response.content == _BYTES
    assert response.headers["content-type"] == "image/png"
    assert response.headers["etag"] == _ETAG
    # Behind songbird's login, so no shared cache may keep it; the browser's year stays.
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert response.headers["vary"] == "Origin"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert fake.asset_calls == [("EMB", "chart-99.png", None)]


async def test_the_browsers_etag_reaches_concord_and_a_304_comes_back(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(asset=_asset(not_modified=True, content=b"", media_type=None))
    async with client_for(fake) as client:
        response = await client.get(_URL, headers={"If-None-Match": _ETAG})
    assert response.status_code == 304
    assert response.content == b""
    assert response.headers["etag"] == _ETAG
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert fake.asset_calls == [("EMB", "chart-99.png", _ETAG)]


async def test_a_picture_concord_lacks_is_a_404(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(FakeConcordClient()) as client:  # no asset → Concord's 404
        response = await client.get(_URL)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "NOT_FOUND"


async def test_an_unreachable_concord_is_a_502_with_nothing_to_cache(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    down = ConcordUnreachableError("http://concord.test", ConnectionError("down"))
    async with client_for(FakeConcordClient(error=down)) as client:
        response = await client.get(_URL)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
    assert "cache-control" not in response.headers
    assert "etag" not in response.headers


@pytest.mark.parametrize("media_type", ["text/html", "image/svg+xml", None])
async def test_anything_but_a_jpeg_or_png_is_refused(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    media_type: str | None,
) -> None:
    # songbird's origin holds the user's session: it never relays a page or a script as a picture.
    fake = FakeConcordClient(asset=_asset(media_type=media_type, content=b"<script>made-up</script>"))
    async with client_for(fake) as client:
        response = await client.get(_URL)
    assert response.status_code == 502
    assert b"<script>" not in response.content


async def test_dot_segments_are_refused_before_any_call(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(asset=_asset())
    async with client_for(fake) as client:
        # httpx would normalise a literal "..", so send it encoded; the route sees it decoded.
        name_dots = await client.get("/api/v1/translations/EMB/assets/%2E%2E")
        translation_dots = await client.get("/api/v1/translations/%2E%2E/assets/chart-99.png")
    # songbird's own refusal (its JSON error), not a route that failed to match.
    for response in (name_dots, translation_dots):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "NOT_FOUND"
    assert fake.asset_calls == []


async def test_a_signed_out_browser_gets_no_picture(
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(asset=_asset())
    async with unauth_client(fake) as client:
        response = await client.get(_URL)
    assert response.status_code == 401
    assert fake.asset_calls == []


# --- The client ---


async def test_the_client_asks_for_the_encoded_name_and_forwards_the_etag() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            content=_BYTES,
            headers={
                "content-type": "image/png",
                "etag": _ETAG,
                "cache-control": _CONCORD_CACHE,
                "vary": "Origin",
            },
        )

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    asset = await client.get_asset("EMB", "chart 99.png", if_none_match='"old"')
    await client.aclose()
    assert seen[0].url.raw_path == b"/v1/translations/EMB/assets/chart%2099.png"
    assert seen[0].headers["if-none-match"] == '"old"'
    assert asset == ConcordAsset(
        not_modified=False,
        content=_BYTES,
        media_type="image/png",
        etag=_ETAG,
        cache_control=_CONCORD_CACHE,
        vary="Origin",
    )


async def test_the_client_reads_a_304_as_not_modified_not_as_an_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(304, headers={"etag": _ETAG, "cache-control": _CONCORD_CACHE})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    asset = await client.get_asset("EMB", "chart-99.png", if_none_match=_ETAG)
    await client.aclose()
    assert asset.not_modified
    assert asset.content == b""
    assert asset.etag == _ETAG


@pytest.mark.parametrize(
    ("status", "error"),
    [(404, "ConcordNotFoundError"), (500, "ConcordUnreachableError")],
)
async def test_the_client_maps_concords_errors(status: int, error: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"code": "unknown_asset"}})

    client = ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))
    with pytest.raises(Exception) as raised:
        await client.get_asset("EMB", "chart-99.png")
    await client.aclose()
    assert type(raised.value).__name__ == error
