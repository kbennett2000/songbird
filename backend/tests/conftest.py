"""Test fixtures.

The fast suite never needs a live Concord: routes depend on `get_concord_client`, overridden
with a `FakeConcordClient`. They also depend on `get_db`, overridden to use an in-memory SQLite
DB (shared via StaticPool) seeded with the default author. The app's lifespan is not run, so
tests stay hermetic.
"""

import os

os.environ.setdefault("DATA_DIR", "/tmp/songbird-test-data")

from collections.abc import AsyncIterator, Callable

import httpx
import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from songbird.api.deps import get_concord_client, get_current_user, get_db
from songbird.concord.schemas import (
    Book,
    Chapter,
    ConcordHealth,
    CrossRefResponse,
    KeywordSearchResponse,
    NoteSearchResponse,
    NotesResponse,
    PlaceDetail,
    PlacesPage,
    PlaceVersesResponse,
    SemanticSearchResponse,
    Translation,
    VersePlacesResponse,
)
from songbird.db import models  # noqa: F401  (register models on Base.metadata)
from songbird.db.base import Base
from songbird.db.models import User
from songbird.main import create_app
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


class FakeConcordClient:
    """Duck-types ConcordClient for tests. Returns canned data or raises `error`."""

    def __init__(
        self,
        *,
        health: ConcordHealth | None = None,
        translations: list[Translation] | None = None,
        chapter: Chapter | None = None,
        books: list[Book] | None = None,
        cross_refs: CrossRefResponse | None = None,
        places: VersePlacesResponse | None = None,
        place_verses: PlaceVersesResponse | None = None,
        notes: NotesResponse | None = None,
        semantic: SemanticSearchResponse | None = None,
        keyword: KeywordSearchResponse | None = None,
        note_search: NoteSearchResponse | None = None,
        places_page: PlacesPage | None = None,
        place_detail: PlaceDetail | None = None,
        place_types: list[str] | None = None,
        error: Exception | None = None,
        base_url: str = "http://concord.test",
    ) -> None:
        self._health = health
        self._translations = translations or []
        self._chapter = chapter
        self._books = books or []
        self._cross_refs = cross_refs
        self._places = places
        self._place_verses = place_verses
        self._notes = notes
        self._semantic = semantic
        self._keyword = keyword
        self._note_search = note_search
        self._places_page = places_page
        self._place_detail = place_detail
        self._place_types = place_types or []
        self._error = error
        # Records the last `list_places` filter args so tests can assert filter/pagination passthrough.
        self.last_list_places: dict[str, object] = {}
        self.base_url = base_url
        # Records the last `keyword_search` translations arg so tests can assert the endpoint's
        # CSV→list parse and the absent→None (search-all) default.
        self.last_keyword_translations: list[str] | None = None

    async def health(self) -> ConcordHealth:
        if self._error is not None:
            raise self._error
        assert self._health is not None
        return self._health

    async def list_translations(self) -> list[Translation]:
        if self._error is not None:
            raise self._error
        return self._translations

    async def list_books(self) -> list[Book]:
        if self._error is not None:
            raise self._error
        return self._books

    async def get_chapter(self, book: str, chapter: int, translation: str) -> Chapter:
        if self._error is not None:
            raise self._error
        assert self._chapter is not None
        return self._chapter

    async def resolve_reference(self, ref: str) -> Chapter:
        if self._error is not None:
            raise self._error
        assert self._chapter is not None
        return self._chapter

    async def get_cross_references(
        self, book: str, chapter: int, verse: int, translation: str | None = None
    ) -> CrossRefResponse:
        if self._error is not None:
            raise self._error
        return (
            self._cross_refs
            if self._cross_refs is not None
            else CrossRefResponse(cross_references=[])
        )

    async def get_places(self, book: str, chapter: int) -> VersePlacesResponse:
        if self._error is not None:
            raise self._error
        return self._places if self._places is not None else VersePlacesResponse(places=[])

    async def get_place_verses(self, place_id: str) -> PlaceVersesResponse:
        if self._error is not None:
            raise self._error
        return (
            self._place_verses if self._place_verses is not None else PlaceVersesResponse(verses=[])
        )

    async def list_places(
        self,
        type: str | None = None,
        status: str | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PlacesPage:
        self.last_list_places = {
            "type": type,
            "status": status,
            "q": q,
            "limit": limit,
            "offset": offset,
        }
        if self._error is not None:
            raise self._error
        return self._places_page if self._places_page is not None else PlacesPage(places=[], total=0)

    async def get_place(self, place_id: str) -> PlaceDetail:
        if self._error is not None:
            raise self._error
        assert self._place_detail is not None
        return self._place_detail

    async def list_place_types(self) -> list[str]:
        # The real client swallows failures to [] (the UI hides the filter), so the fake never raises.
        return self._place_types

    async def get_notes(self, translation: str, book: str, chapter: int) -> NotesResponse:
        if self._error is not None:
            raise self._error
        return (
            self._notes
            if self._notes is not None
            else NotesResponse(
                translation=translation, book=book, chapter=chapter, verse=None, total=0, notes=[]
            )
        )

    async def semantic_search(
        self, q: str, translation: str | None = None, limit: int = 20
    ) -> SemanticSearchResponse:
        if self._error is not None:
            raise self._error
        return self._semantic if self._semantic is not None else SemanticSearchResponse(results=[])

    async def keyword_search(
        self,
        q: str,
        translations: list[str] | None = None,
        book: str | None = None,
        limit: int = 20,
    ) -> KeywordSearchResponse:
        self.last_keyword_translations = translations
        if self._error is not None:
            raise self._error
        return self._keyword if self._keyword is not None else KeywordSearchResponse(hits=[])

    async def search_notes(self, q: str, limit: int = 20) -> NoteSearchResponse:
        if self._error is not None:
            raise self._error
        return self._note_search if self._note_search is not None else NoteSearchResponse(hits=[])


@pytest_asyncio.fixture
async def db_sessionmaker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    async with sessionmaker() as session:  # seed the default author
        session.add(User(id=1, name="default"))
        await session.commit()
    yield sessionmaker
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with db_sessionmaker() as session:
        yield session


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
def make_concord() -> type[FakeConcordClient]:
    return FakeConcordClient


@pytest.fixture
def client_for(
    app: FastAPI,
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> Callable[[FakeConcordClient], httpx.AsyncClient]:
    """Authenticated client: `get_current_user` is overridden to the seeded user (id=1), so the
    whole pre-auth suite stays green behind the Slice 8 gate. Annotations created in those tests
    get author_id=1 and the overlay filters to author 1 — i.e. unchanged behavior. Tests that
    need the *real* auth flow (cookies, 401s, multi-user scoping) use `unauth_client` instead."""

    def _build(concord: FakeConcordClient) -> httpx.AsyncClient:
        async def _get_db_override() -> AsyncIterator[AsyncSession]:
            async with db_sessionmaker() as session:
                yield session

        async def _current_user_override(
            db: AsyncSession = Depends(get_db),
        ) -> User:
            user = await db.get(User, 1)
            assert user is not None
            return user

        app.dependency_overrides[get_concord_client] = lambda: concord
        app.dependency_overrides[get_db] = _get_db_override
        app.dependency_overrides[get_current_user] = _current_user_override
        transport = httpx.ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    return _build


@pytest.fixture
def unauth_client(
    app: FastAPI,
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> Callable[[FakeConcordClient], httpx.AsyncClient]:
    """Real-auth client: only get_db + get_concord_client overridden — `get_current_user` runs
    for real (cookie → session → user), and the cookie jar persists across requests, so the full
    register/login/logout flow and gated-route 401s are exercised end to end."""

    def _build(concord: FakeConcordClient) -> httpx.AsyncClient:
        async def _get_db_override() -> AsyncIterator[AsyncSession]:
            async with db_sessionmaker() as session:
                yield session

        app.dependency_overrides[get_concord_client] = lambda: concord
        app.dependency_overrides[get_db] = _get_db_override
        transport = httpx.ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    return _build
