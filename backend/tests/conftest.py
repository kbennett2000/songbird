"""Test fixtures.

The fast suite never needs a live Concord: routes depend on `get_concord_client`, overridden
with a `FakeConcordClient`. They also depend on `get_db`, overridden to use an in-memory SQLite
DB (shared via StaticPool) seeded with the default author. The app's lifespan is not run, so
tests stay hermetic.
"""

import os

os.environ.setdefault("DATA_DIR", "/tmp/songbird-test-data")

from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime

import httpx
import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from songbird.api.deps import (
    get_concord_client,
    get_current_user,
    get_db,
    get_scan_runner_optional,
    get_youtube_client_optional,
)
from songbird.concord.client import ConcordNotFoundError
from songbird.concord.schemas import (
    Book,
    Chapter,
    ConcordHealth,
    CrossRefResponse,
    HeadingsResponse,
    JourneyDetail,
    JourneysResponse,
    KeywordSearchResponse,
    NoteSearchResponse,
    NotesResponse,
    PlaceDetail,
    PlaceJourneysResponse,
    PlacesPage,
    PlaceVersesResponse,
    RandomVerse,
    SemanticSearchResponse,
    StrongsDetail,
    StrongsVersesResponse,
    TopicDetail,
    TopicsResponse,
    TopicVersesResponse,
    Translation,
    VersePlacesResponse,
    VerseTopicsResponse,
    VerseWordsResponse,
)
from songbird.db import models  # noqa: F401  (register models on Base.metadata)
from songbird.db.base import Base
from songbird.db.models import User
from songbird.main import create_app
from songbird.sermons.scan import ScanRunner
from songbird.youtube.client import YouTubeNotFoundError
from songbird.youtube.schemas import Channel, Playlist, PlaylistItem, PlaylistPage, Video
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
        resolved: Chapter | None = None,
        resolved_by_ref: dict[str, Chapter | Exception] | None = None,
        books: list[Book] | None = None,
        cross_refs: CrossRefResponse | None = None,
        verse_topics: VerseTopicsResponse | None = None,
        topic_verses: TopicVersesResponse | None = None,
        topics_page: TopicsResponse | None = None,
        topic_detail: TopicDetail | None = None,
        verse_words: VerseWordsResponse | None = None,
        strongs: StrongsDetail | None = None,
        strongs_verses: StrongsVersesResponse | None = None,
        journeys_page: JourneysResponse | None = None,
        journey: JourneyDetail | None = None,
        place_journeys: PlaceJourneysResponse | None = None,
        places: VersePlacesResponse | None = None,
        place_verses: PlaceVersesResponse | None = None,
        notes: NotesResponse | None = None,
        headings: HeadingsResponse | None = None,
        semantic: SemanticSearchResponse | None = None,
        keyword: KeywordSearchResponse | None = None,
        note_search: NoteSearchResponse | None = None,
        places_page: PlacesPage | None = None,
        place_detail: PlaceDetail | None = None,
        place_types: list[str] | None = None,
        random: RandomVerse | None = None,
        error: Exception | None = None,
        base_url: str = "http://concord.test",
    ) -> None:
        self._health = health
        self._translations = translations or []
        self._chapter = chapter
        # What `resolve_reference` returns (a human ref → its canonical verse span). Falls back
        # to `chapter` when not set, so tests that don't care about the span need no extra wiring.
        self._resolved = resolved
        # Per-reference answers, for the passage rules (spec §7). A route resolves ONE reference
        # per request and `resolved` above is enough for it; a check resolves every candidate it
        # found in a video's text, and the whole design is that Concord accepts some and rejects
        # others. An Exception value is raised, so a fake can 404 one string and answer another.
        # A reference absent from the dict falls through to the single-answer behaviour above —
        # which is what keeps every test written before this existed working untouched.
        self._resolved_by_ref = resolved_by_ref
        # Every reference `resolve_reference` was asked for, in order. Lets a test prove what
        # normalization reached Concord, and that the run's cache stopped it being asked twice.
        self.resolve_calls: list[str] = []
        self._books = books or []
        self._cross_refs = cross_refs
        self._verse_topics = verse_topics
        self._topic_verses = topic_verses
        self._topics_page = topics_page
        self._topic_detail = topic_detail
        self._verse_words = verse_words
        self._strongs = strongs
        self._strongs_verses = strongs_verses
        self._journeys_page = journeys_page
        self._journey = journey
        self._place_journeys = place_journeys
        self._places = places
        self._place_verses = place_verses
        self._notes = notes
        self._headings = headings
        self._semantic = semantic
        self._keyword = keyword
        self._note_search = note_search
        self._places_page = places_page
        self._place_detail = place_detail
        self._place_types = place_types or []
        self._random = random
        self._error = error
        # Records the last `list_places` filter args so tests can assert filter/pagination passthrough.
        self.last_list_places: dict[str, object] = {}
        # Records the last `list_topics` filter args so tests can assert filter/pagination passthrough.
        self.last_list_topics: dict[str, object] = {}
        # Records the last `list_journeys` pagination args so tests can assert passthrough.
        self.last_list_journeys: dict[str, object] = {}
        # Records the last `random_verse` translation arg so tests can assert passthrough.
        self.last_random_translation: str | None = None
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
        self.resolve_calls.append(ref)
        if self._error is not None:
            raise self._error
        if self._resolved_by_ref is not None:
            answer = self._resolved_by_ref.get(ref)
            if isinstance(answer, Exception):
                raise answer
            if answer is not None:
                return answer
            # Not in the dict: with a per-reference map in play, silence means "Concord does not
            # know this one" — the normal outcome for most of what the finder offers.
            raise ConcordNotFoundError(f"Concord could not resolve '{ref}'")
        resolved = self._resolved if self._resolved is not None else self._chapter
        assert resolved is not None
        return resolved

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

    async def get_verse_topics(self, book: str, chapter: int, verse: int) -> VerseTopicsResponse:
        if self._error is not None:
            raise self._error
        return (
            self._verse_topics
            if self._verse_topics is not None
            else VerseTopicsResponse(reference=f"{book} {chapter}:{verse}", total=0, topics=[])
        )

    async def get_topic_verses(
        self, topic_id: str, translation: str | None = None, limit: int = 50, offset: int = 0
    ) -> TopicVersesResponse:
        if self._error is not None:
            raise self._error
        return (
            self._topic_verses
            if self._topic_verses is not None
            else TopicVersesResponse(
                id=topic_id,
                translation=translation,
                include_text=True,
                limit=limit,
                offset=offset,
                total=0,
                verses=[],
            )
        )

    async def list_topics(
        self,
        q: str | None = None,
        section: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> TopicsResponse:
        self.last_list_topics = {
            "q": q,
            "section": section,
            "limit": limit,
            "offset": offset,
        }
        if self._error is not None:
            raise self._error
        return (
            self._topics_page
            if self._topics_page is not None
            else TopicsResponse(
                q=q, section=section, limit=limit, offset=offset, total=0, topics=[]
            )
        )

    async def get_topic(self, topic_id: str) -> TopicDetail:
        if self._error is not None:
            raise self._error
        assert self._topic_detail is not None
        return self._topic_detail

    async def get_verse_words(self, book: str, chapter: int, verse: int) -> VerseWordsResponse:
        if self._error is not None:
            raise self._error
        return (
            self._verse_words
            if self._verse_words is not None
            else VerseWordsResponse(
                reference=f"{book} {chapter}:{verse}", text_id="SBLGNT", total=0, tokens=[]
            )
        )

    async def get_strongs(self, strongs_id: str) -> StrongsDetail:
        if self._error is not None:
            raise self._error
        assert self._strongs is not None
        return self._strongs

    async def get_strongs_verses(
        self, strongs_id: str, translation: str | None = None, limit: int = 50, offset: int = 0
    ) -> StrongsVersesResponse:
        if self._error is not None:
            raise self._error
        return (
            self._strongs_verses
            if self._strongs_verses is not None
            else StrongsVersesResponse(
                strongs_id=strongs_id,
                text_id="SBLGNT",
                translation=translation,
                include_text=True,
                limit=limit,
                offset=offset,
                total=0,
                verses=[],
            )
        )

    async def list_journeys(self, limit: int = 50, offset: int = 0) -> JourneysResponse:
        self.last_list_journeys = {"limit": limit, "offset": offset}
        if self._error is not None:
            raise self._error
        return (
            self._journeys_page
            if self._journeys_page is not None
            else JourneysResponse(limit=limit, offset=offset, total=0, journeys=[])
        )

    async def get_journey(self, journey_id: str) -> JourneyDetail:
        if self._error is not None:
            raise self._error
        assert self._journey is not None
        return self._journey

    async def get_place_journeys(self, place_id: str) -> PlaceJourneysResponse:
        if self._error is not None:
            raise self._error
        return (
            self._place_journeys
            if self._place_journeys is not None
            else PlaceJourneysResponse(id=place_id, total=0, journeys=[])
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
        return (
            self._places_page if self._places_page is not None else PlacesPage(places=[], total=0)
        )

    async def get_place(self, place_id: str) -> PlaceDetail:
        if self._error is not None:
            raise self._error
        assert self._place_detail is not None
        return self._place_detail

    async def list_place_types(self) -> list[str]:
        # The real client swallows failures to [] (the UI hides the filter), so the fake never raises.
        return self._place_types

    async def random_verse(self, translation: str | None = None) -> RandomVerse:
        self.last_random_translation = translation
        if self._error is not None:
            raise self._error
        assert self._random is not None
        return self._random

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

    async def get_headings(self, translation: str, book: str, chapter: int) -> HeadingsResponse:
        if self._error is not None:
            raise self._error
        return (
            self._headings
            if self._headings is not None
            else HeadingsResponse(
                translation=translation, book=book, chapter=chapter, total=0, headings=[]
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


class FakeYouTubeClient:
    """Duck-types YouTubeClient for tests. Returns canned videos or raises `error`.

    Mirrors FakeConcordClient deliberately, including the `error` contract — but note the
    difference in what that error MEANS: an unreachable Concord is fatal (invariant 3), while an
    unreachable YouTube is a condition a source records and the app survives (spec §2).
    """

    def __init__(
        self,
        *,
        videos: list[Video] | None = None,
        channels: dict[str, Channel] | None = None,
        playlists: dict[str, Playlist] | None = None,
        pages: dict[str, list[list[str]]] | None = None,
        error: Exception | None = None,
        page_error: Exception | None = None,
        error_after_pages: int | None = None,
    ) -> None:
        self._videos = videos or []
        # Keyed by whatever a test wants to look one up BY — a handle or an id — because the
        # real API resolves both to the same channel and songbird calls whichever the pasted
        # link named. A key that isn't here is a not-found, which is how the real client reads
        # YouTube's "200 with no items".
        self._channels = channels or {}
        self._playlists = playlists or {}
        # A playlist's contents as PAGES of ids, keyed by the playlist id the scan will ask for
        # (an uploads UU… list, or a PL… list for a playlist source). A list of lists rather than
        # a flat list because paging is the behaviour under test: where the page boundaries fall
        # is what decides whether an incremental scan stops in the right place.
        self._pages = pages or {}
        self._error = error
        # Raised by `list_playlist_page` alone, so a test can fail the PAGER without also failing
        # the detail fetch — they are different failures at different points in a walk.
        self._page_error = page_error
        # Raise `error` only once this many detail batches have already succeeded, which is how a
        # test makes a source fail PART WAY through and check that the committed batches survive.
        self._error_after_pages = error_after_pages
        # Records the ids of every get_videos call so tests can assert batching/passthrough.
        self.get_videos_calls: list[list[str]] = []
        # Every (playlist_id, page_token) the scan asked for, in order — how a test proves an
        # incremental walk stopped early rather than merely produced the right rows.
        self.page_calls: list[tuple[str, str | None]] = []
        # Records every channel/playlist lookup as (kind, value), so a test can assert songbird
        # asked the right question — resolving a handle is a different call from fetching an id.
        self.lookups: list[tuple[str, str]] = []

    async def get_videos(self, ids: list[str]) -> list[Video]:
        self.get_videos_calls.append(list(ids))
        if self._error is not None and (
            self._error_after_pages is None
            or len(self.get_videos_calls) > self._error_after_pages
        ):
            raise self._error
        # Ordered by the REQUEST, like the real client, so a test that seeds videos in a
        # different order than it pages them still gets a deterministic answer.
        by_id = {v.id: v for v in self._videos}
        return [by_id[i] for i in ids if i in by_id]

    async def list_playlist_page(
        self, playlist_id: str, page_token: str | None = None
    ) -> PlaylistPage:
        self.page_calls.append((playlist_id, page_token))
        if self._page_error is not None:
            raise self._page_error
        pages = self._pages.get(playlist_id, [])
        index = 0 if page_token is None else int(page_token)
        if index >= len(pages):
            return PlaylistPage(items=[], next_page_token=None)
        # The token is just the next index — opaque to the caller, which is the only thing the
        # real cursor guarantees about itself.
        nxt = str(index + 1) if index + 1 < len(pages) else None
        return PlaylistPage(
            items=[
                PlaylistItem(video_id=v, published_at=datetime(2026, 1, 1, tzinfo=UTC))
                for v in pages[index]
            ],
            next_page_token=nxt,
        )

    def _channel(self, key: str) -> Channel:
        if self._error is not None:
            raise self._error
        channel = self._channels.get(key)
        if channel is None:
            raise YouTubeNotFoundError(f"YouTube has no channel {key}")
        return channel

    async def resolve_channel_by_handle(self, handle: str) -> Channel:
        self.lookups.append(("handle", handle))
        return self._channel(handle)

    async def get_channel(self, channel_id: str) -> Channel:
        self.lookups.append(("channel", channel_id))
        return self._channel(channel_id)

    async def get_playlist(self, playlist_id: str) -> Playlist:
        self.lookups.append(("playlist", playlist_id))
        if self._error is not None:
            raise self._error
        playlist = self._playlists.get(playlist_id)
        if playlist is None:
            raise YouTubeNotFoundError(f"YouTube has no playlist {playlist_id}")
        return playlist

    async def aclose(self) -> None:
        return None


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
def with_youtube(app: FastAPI) -> Callable[[FakeYouTubeClient], None]:
    """Install a fake YouTube client for routes that depend on the YouTube client.

    Standalone rather than a second argument to `client_for`, so the ~20 test files that annotate
    that fixture as `Callable[[FakeConcordClient], httpx.AsyncClient]` need no change.

    It overrides the OPTIONAL dependency — the single seam — and `get_youtube_client` resolves
    through it, so both the routes that demand a client and the status endpoint that merely asks
    whether there is one see the same fake. Not installing it is how a test says "no key".
    """

    def _install(youtube: FakeYouTubeClient) -> None:
        app.dependency_overrides[get_youtube_client_optional] = lambda: youtube

    return _install


@pytest.fixture
def with_scan_runner(
    app: FastAPI, db_sessionmaker: async_sessionmaker[AsyncSession]
) -> Callable[..., ScanRunner]:
    """Install a scan runner over the in-memory DB, and hand it back so the test can drive it.

    Tests `await runner.run()` rather than calling `request_scan()`: the loop is the behaviour,
    the asyncio task is the plumbing, and awaiting it means no test ever sleeps or polls.

    Not installing this is how a test says "no runner" — which is also the state the whole fast
    suite is in by default, since the app fixture never runs the lifespan. That is what keeps
    slice 3's tests honest: they POST a source, the request is recorded on the row, and nothing
    starts.

    The Concord client defaults to one that recognises nothing, which is what a route test wants:
    the videos get fetched and filtered, and every candidate the finder offers is refused, so rows
    land in the review list without the test having to say anything about passages.
    """

    def _install(
        youtube: FakeYouTubeClient, concord: FakeConcordClient | None = None
    ) -> ScanRunner:
        runner = ScanRunner(
            db_sessionmaker,
            youtube,  # type: ignore[arg-type]
            concord or FakeConcordClient(resolved_by_ref={}),  # type: ignore[arg-type]
            default_min_minutes=10,
        )
        app.dependency_overrides[get_scan_runner_optional] = lambda: runner
        return runner

    return _install


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
