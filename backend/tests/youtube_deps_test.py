"""The two YouTube client dependencies.

No key configured means the sermon-source feature is simply switched off (spec §2) — a normal
state, not a server fault — so `get_youtube_client` answers 409, not 500 or 503. Its optional
sibling answers None instead, because the Sources page's status endpoint has to REPORT that
there is no key rather than refuse; the demanding one derives from the optional one, so a test
that overrides the seam moves both.

These are tested through a probe route on a throwaway app rather than the shared `app` fixture:
`create_app()` registers the SPA catch-all `/{full_path:path}`, which would shadow a route added
afterwards. The real routes behind them are covered by the re-date and sources suites.
"""

import httpx
import pytest
from fastapi import Depends, FastAPI
from songbird.api.deps import get_youtube_client, get_youtube_client_optional
from songbird.youtube.client import YouTubeClient
from tests.conftest import FakeYouTubeClient


def _probe_app(youtube: object) -> FastAPI:
    app = FastAPI()
    app.state.youtube = youtube

    @app.get("/probe")
    async def probe(client: YouTubeClient = Depends(get_youtube_client)) -> dict[str, bool]:
        return {"got_client": client is not None}

    return app


async def test_no_client_is_409_youtube_not_configured() -> None:
    transport = httpx.ASGITransport(app=_probe_app(None))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/probe")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "YOUTUBE_NOT_CONFIGURED"


async def test_a_configured_client_is_returned() -> None:
    transport = httpx.ASGITransport(app=_probe_app(FakeYouTubeClient()))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/probe")
    assert resp.status_code == 200
    assert resp.json() == {"got_client": True}


async def test_a_missing_attribute_is_409_not_a_500() -> None:
    # The fast suite never runs the lifespan, so app.state.youtube may not exist at all. A bare
    # attribute read would raise AttributeError and 500 the request.
    app = FastAPI()

    @app.get("/probe")
    async def probe(client: YouTubeClient = Depends(get_youtube_client)) -> dict[str, bool]:
        return {"got_client": True}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/probe")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "YOUTUBE_NOT_CONFIGURED"


def test_the_fake_records_what_it_was_asked_for() -> None:
    # The fake is the harness the re-date slice will lean on; its spy is the part that must work.
    fake = FakeYouTubeClient()
    assert fake.get_videos_calls == []


async def test_the_fake_raises_the_error_it_was_given() -> None:
    boom = RuntimeError("quota")
    fake = FakeYouTubeClient(error=boom)
    with pytest.raises(RuntimeError):
        await fake.get_videos(["dQw4w9WgXcQ"])
    assert fake.get_videos_calls == [["dQw4w9WgXcQ"]]


async def test_the_optional_dependency_answers_instead_of_refusing() -> None:
    """The seam the Sources page hangs off (v1.7 slice 3).

    `get_youtube_client` refuses when there is no key, which is right for every route that
    actually talks to YouTube — and wrong for the one route that has to REPORT there is no key.
    So the read and the demand are separate, and the demanding one derives from the reading one.
    """
    app = FastAPI()

    @app.get("/probe")
    async def probe(  # pyright: ignore[reportUnusedFunction]
        client: YouTubeClient | None = Depends(get_youtube_client_optional),
    ) -> dict[str, bool]:
        return {"configured": client is not None}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # No lifespan has run, so the attribute does not exist at all.
        no_key = await client.get("/probe")
        app.state.youtube = FakeYouTubeClient()
        with_key = await client.get("/probe")

    assert no_key.status_code == 200
    assert no_key.json() == {"configured": False}
    assert with_key.json() == {"configured": True}
