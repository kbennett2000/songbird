"""The `get_youtube_client` dependency.

No key configured means the sermon-source feature is simply switched off (spec §2) — a normal
state, not a server fault — so the dependency answers 409, not 500 or 503.

No route depends on it yet (the first is the re-date endpoint), so these tests hang a probe
route off a throwaway app. It cannot be the shared `app` fixture: `create_app()` registers the
SPA catch-all `/{full_path:path}`, which would shadow a route added afterwards.
"""

import httpx
import pytest
from fastapi import Depends, FastAPI
from songbird.api.deps import get_youtube_client
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
