"""Async SQLAlchemy engine + session wiring (soap-journal pattern)."""

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from songbird.config import get_settings


def _build_engine() -> AsyncEngine:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return create_async_engine(settings.database_url, future=True)


engine: AsyncEngine = _build_engine()

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)


@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:  # pyright: ignore[reportUnusedFunction]
    """WAL and a busy timeout, because v1.7 slice 4a gave songbird a writer outside a request.

    Until the sermon scan, every write WAS a request, and FastAPI served them one at a time — so
    two writers never really met. The scan is a background task that commits a batch every couple
    of seconds for minutes at a time, and in SQLite's default rollback-journal mode a reader and
    that writer cannot coexist: someone saving a note mid-scan would get "database is locked".

    WAL lets readers carry on straight through a write; the busy timeout makes the two writers
    wait for each other rather than fail. Set per connection, because both pragmas are connection
    state — WAL is recorded in the file and persists, but asking for it costs nothing.

    One consequence worth knowing: WAL keeps `songbird.db-wal` and `songbird.db-shm` alongside the
    database, so a backup has to copy the directory rather than the one file (docs/SECURITY.md).
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session
