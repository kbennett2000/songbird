"""FastAPI app factory + lifespan + SPA mount.

Run with: `uvicorn songbird.main:create_app --factory`.
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from songbird import __version__
from songbird.api.annotations import router as annotations_router
from songbird.api.concord import router as concord_router
from songbird.api.health import router as health_router
from songbird.api.read import router as read_router
from songbird.api.tags import router as tags_router
from songbird.concord.client import ConcordClient
from songbird.config import get_settings

logger = logging.getLogger("songbird")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    app.state.concord = ConcordClient(settings.concord_base_url, settings.concord_timeout)
    logger.info("songbird %s starting; Concord at %s", __version__, settings.concord_base_url)
    try:
        yield
    finally:
        await app.state.concord.aclose()


def _mount_frontend(app: FastAPI, dist_dir: Path) -> None:
    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    index_file = dist_dir / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:  # pyright: ignore[reportUnusedFunction]
        candidate = dist_dir / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)


def create_app() -> FastAPI:
    if not logging.getLogger("songbird").handlers and not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        )

    app = FastAPI(title="songbird", version=__version__, lifespan=lifespan)

    # Routers BEFORE the SPA catch-all so API paths win.
    app.include_router(health_router)
    app.include_router(concord_router)
    app.include_router(read_router)
    app.include_router(annotations_router)
    app.include_router(tags_router)

    settings = get_settings()
    dist_dir = settings.frontend_dist_dir
    if dist_dir is not None and dist_dir.is_dir():
        _mount_frontend(app, dist_dir)

    return app
