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
from songbird.api.journeys import router as journeys_router
from songbird.api.notes import router as notes_router
from songbird.api.read import router as read_router
from songbird.api.search import router as search_router
from songbird.api.sermon_notes import router as sermon_notes_router
from songbird.api.sermon_redate import router as sermon_redate_router
from songbird.api.sermon_sources import router as sermon_sources_router
from songbird.api.strongs import router as strongs_router
from songbird.api.tags import router as tags_router
from songbird.api.topics import router as topics_router
from songbird.concord.client import ConcordClient
from songbird.config import get_settings
from songbird.core.sessions import cleanup_all_expired_sessions
from songbird.db.session import async_session_factory
from songbird.sermons.scan import ScanRunner
from songbird.youtube.client import YouTubeClient

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
    # YouTube is optional: no key means the sermon-source feature is off and nothing else
    # changes (spec §2). Assigned on every boot path so the dependency has something to read.
    app.state.youtube = (
        YouTubeClient(settings.youtube_api_key) if settings.youtube_api_key else None
    )
    # No key means nothing to scan, so there is no runner at all — one null check at the seam
    # instead of a runner that can only ever answer "switched off". It is built here rather than
    # started here: nothing runs until a source is added or "Check now" is pressed (the scheduled
    # check, spec §6c, is slice 6). Note the moment this deploys, every existing source has a null
    # `last_checked_at` and so is due — the first check will scan all of their back catalogues.
    app.state.sermon_scan = (
        ScanRunner(
            async_session_factory,
            app.state.youtube,
            default_min_minutes=settings.sermon_min_minutes,
        )
        if app.state.youtube is not None
        else None
    )
    logger.info("songbird %s starting; Concord at %s", __version__, settings.concord_base_url)
    logger.info("sermon sources: %s", "on" if app.state.youtube else "off (no YOUTUBE_API_KEY)")
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
        # Nested so every close still happens if an earlier one raises. ASGI swallows
        # lifespan-shutdown errors, so a flat sequence would leak it silently.
        #
        # The scan stops FIRST, because it holds the YouTube client the next line closes — the
        # other order would leave an in-flight request against a closed transport, raising inside
        # a task nobody awaits.
        try:
            if app.state.sermon_scan is not None:
                await app.state.sermon_scan.aclose()
        finally:
            try:
                if app.state.youtube is not None:
                    await app.state.youtube.aclose()
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
    app.include_router(journeys_router, dependencies=gated)
    app.include_router(sermon_notes_router, dependencies=gated)
    app.include_router(sermon_redate_router, dependencies=gated)
    app.include_router(sermon_sources_router, dependencies=gated)
    app.include_router(search_router, dependencies=gated)
    app.include_router(import_export_router, dependencies=gated)

    settings = get_settings()
    dist_dir = settings.frontend_dist_dir
    if dist_dir is not None and dist_dir.is_dir():
        _mount_frontend(app, dist_dir)

    return app
