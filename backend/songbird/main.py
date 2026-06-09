"""FastAPI app factory + lifespan + SPA mount.

Run with: `uvicorn songbird.main:create_app --factory`.
"""

import logging
import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from songbird import __version__
from songbird.api.annotations import router as annotations_router
from songbird.api.auth import router as auth_router
from songbird.api.concord import router as concord_router
from songbird.api.deps import get_current_user
from songbird.api.geography import router as geography_router
from songbird.api.headings import router as headings_router
from songbird.api.health import router as health_router
from songbird.api.import_export import router as import_export_router
from songbird.api.notes import router as notes_router
from songbird.api.read import router as read_router
from songbird.api.search import router as search_router
from songbird.api.sermon_notes import router as sermon_notes_router
from songbird.api.strongs import router as strongs_router
from songbird.api.tags import router as tags_router
from songbird.api.topics import router as topics_router
from songbird.concord.client import ConcordClient
from songbird.config import get_settings
from songbird.core.sessions import cleanup_all_expired_sessions
from songbird.db.session import async_session_factory

logger = logging.getLogger("songbird")

# StaticFiles guesses content types via the stdlib mimetypes registry, which doesn't know these
# map-tile extensions and would serve them as text/plain. Register honest types so /tiles responses
# are correct. (The PMTiles client reads raw bytes over Range and ignores the header, so this is
# correctness, not the basemap's load path — that relies only on Range, which StaticFiles provides.)
mimetypes.add_type("application/octet-stream", ".pmtiles")
mimetypes.add_type("application/geo+json", ".geojson")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    app.state.concord = ConcordClient(settings.concord_base_url, settings.concord_timeout)
    logger.info("songbird %s starting; Concord at %s", __version__, settings.concord_base_url)
    # Hygiene: sweep dead session rows for users who never return (per-user cleanup only runs on
    # that user's next login). Best-effort — it must never block boot, so failures are logged.
    try:
        async with async_session_factory() as db:
            swept = await cleanup_all_expired_sessions(db)
        if swept:
            logger.info("swept %d expired session(s) at startup", swept)
    except Exception:
        logger.warning("startup session sweep skipped", exc_info=True)
    try:
        yield
    finally:
        await app.state.concord.aclose()


def _mount_frontend(app: FastAPI, dist_dir: Path) -> None:
    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    # Bundled, offline map tiles (relief.pmtiles + bible-physical.geojson). StaticFiles serves
    # HTTP Range (206) + Accept-Ranges, which the PMTiles client relies on. Mounted before the SPA
    # catch-all so tile requests don't fall through to index.html. Still fully offline — these are
    # local files served by songbird's own process (see docs/adr/0003).
    tiles_dir = dist_dir / "tiles"
    if tiles_dir.is_dir():
        app.mount("/tiles", StaticFiles(directory=tiles_dir), name="tiles")
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
    # Open routes: liveness + auth itself.
    app.include_router(health_router)
    app.include_router(auth_router)
    # Everything else requires a logged-in user (gate the whole app, Slice 8). Concord stays
    # user-unaware; the gate is purely songbird's. Annotation/read routes additionally take the
    # user as a value (FastAPI caches the dependency) to scope by author.
    gated = [Depends(get_current_user)]
    app.include_router(concord_router, dependencies=gated)
    app.include_router(read_router, dependencies=gated)
    app.include_router(annotations_router, dependencies=gated)
    app.include_router(tags_router, dependencies=gated)
    app.include_router(geography_router, dependencies=gated)
    app.include_router(notes_router, dependencies=gated)
    app.include_router(headings_router, dependencies=gated)
    app.include_router(topics_router, dependencies=gated)
    app.include_router(strongs_router, dependencies=gated)
    app.include_router(sermon_notes_router, dependencies=gated)
    app.include_router(search_router, dependencies=gated)
    app.include_router(import_export_router, dependencies=gated)

    settings = get_settings()
    dist_dir = settings.frontend_dist_dir
    if dist_dir is not None and dist_dir.is_dir():
        _mount_frontend(app, dist_dir)

    return app
