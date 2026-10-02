"""The single HTTP client songbird uses to talk to Concord.

Routing every Concord call through this one class keeps the base URL and the
unreachable-handling in exactly one place (CLAUDE.md invariants 1–3): Concord is consumed
over HTTP at a configured URL, never embedded; when it is unreachable songbird raises a
clear error rather than falling back.
"""

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from songbird.concord.schemas import (
    Book,
    BooksResponse,
    Chapter,
    ConcordHealth,
    CrossRefResponse,
    Document,
    DocumentsResponse,
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
    TranslationsResponse,
    VersePlacesResponse,
    VerseTopicsResponse,
    VerseWordsResponse,
)

# Keyword search can be slow on a cold Concord — multi-translation FTS over the whole corpus, and
# single-translation searches for the larger translations were observed at 6–8s. Give the *read* a
# generous budget so a slow search isn't misreported as an outage; connect stays tight (the default
# 5s) so a genuinely-down Concord still fails fast (CLAUDE.md invariant 3).
_SEARCH_TIMEOUT = httpx.Timeout(30.0, connect=5.0)

# How long an idle connection to Concord is kept for reuse. Concord's uvicorn closes one after 5 s,
# and httpx's default was also 5 s: a request sent just under 5 s after the last could go out on a
# connection Concord was closing at that instant. Measured against Kris's Concord over the LAN, that
# window opened as early as 4.5 s, so 2 s leaves a wide margin. A new connection on the LAN costs
# about a millisecond; requests within a page load still share one.
_KEEPALIVE_EXPIRY = 2.0

# What httpx raises when the connection a request went out on died under it: closed before any
# response ("Server disconnected without sending a response") or reset. The request never reached
# Concord, so sending it again is safe. Timeouts and connect errors are deliberately absent: a slow
# or down Concord is asked once, and is an error (invariant 3).
_STALE_CONNECTION_ERRORS = (httpx.RemoteProtocolError, httpx.ReadError, httpx.WriteError)

logger = logging.getLogger("songbird")


class _RetryStaleConnection(httpx.AsyncBaseTransport):
    """Sends a GET once more when its connection was closed under it.

    httpcore drops a pooled connection only when its idle timer has run out or the socket already
    reads as closed; a close that lands while the request is being sent surfaces as one of
    `_STALE_CONNECTION_ERRORS`, and httpx retries only connect errors. The dead connection has
    already left the pool, so the second attempt goes out on a live or fresh one. One retry, never
    a loop: a Concord that hangs up on every request is still unreachable after it.
    """

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        try:
            return await self._inner.handle_async_request(request)
        except _STALE_CONNECTION_ERRORS as exc:
            if request.method not in ("GET", "HEAD"):
                raise
            logger.info(
                "Concord connection closed under %s %s (%s); retrying once on a new one",
                request.method,
                request.url.path,
                type(exc).__name__,
            )
            return await self._inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self._inner.aclose()


class ConcordUnreachableError(Exception):
    """Raised when Concord cannot be reached, or returns a server error, over HTTP."""

    def __init__(self, base_url: str, cause: Exception) -> None:
        self.base_url = base_url
        self.cause = cause
        super().__init__(f"Concord at {base_url} is unreachable: {cause}")


class ConcordNotFoundError(Exception):
    """Raised when Concord returns 404 — a real "not found" (e.g. bad book/chapter),
    distinct from being unreachable. Maps to a 404, not a 502."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


@dataclass(frozen=True)
class ConcordAsset:
    """One of a translation's images as Concord answered for it (ADR-0012): the bytes and the
    headers a browser needs to cache them, or — `not_modified` — Concord's 304 for an ETag the
    browser already holds, with no bytes. Held only while a request passes it on."""

    not_modified: bool
    content: bytes
    media_type: str | None
    etag: str | None
    cache_control: str | None
    vary: str | None


class ConcordClient:
    def __init__(
        self,
        base_url: str,
        timeout: float = 5.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url
        # A test's injected transport is wrapped the same way as the real one, so the retry is
        # exercised wherever the client is.
        inner = transport or httpx.AsyncHTTPTransport(
            limits=httpx.Limits(keepalive_expiry=_KEEPALIVE_EXPIRY)
        )
        self._client = httpx.AsyncClient(
            base_url=base_url, timeout=timeout, transport=_RetryStaleConnection(inner)
        )

    @property
    def base_url(self) -> str:
        return self._base_url

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str) -> httpx.Response:
        try:
            response = await self._client.get(path)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return response

    async def health(self) -> ConcordHealth:
        response = await self._get("/healthz")
        return ConcordHealth.model_validate(response.json())

    async def list_translations(self) -> list[Translation]:
        response = await self._get("/v1/translations")
        return TranslationsResponse.model_validate(response.json()).translations

    async def list_books(self) -> list[Book]:
        response = await self._get("/v1/books")
        return BooksResponse.model_validate(response.json()).books

    async def semantic_search(
        self, q: str, translation: str | None = None, limit: int = 20
    ) -> SemanticSearchResponse:
        """Search Scripture by meaning via Concord's embedding model — the heaviest capability
        in the system, reached as a thin HTTP call (the 313MB model lives in Concord, never
        here). A 400/404/422 (bad query / unknown translation) is a client error, not
        unreachability."""
        params: dict[str, str] = {"q": q, "include_text": "true", "limit": str(limit)}
        if translation:
            params["translation"] = translation
        try:
            response = await self._client.get("/v1/semantic-search", params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404, 422):
                raise ConcordNotFoundError(
                    f"Concord could not run that search: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return SemanticSearchResponse.model_validate(response.json())

    async def random_verse(self, translation: str | None = None) -> RandomVerse:
        """One random verse from Concord (`/v1/random`), in the given translation. Concord's
        response is `no-store`, so every call is a fresh verse. A 400/404 (e.g. unknown
        translation) is a client not-found, not unreachability."""
        params: dict[str, str] = {}
        if translation:
            params["translation"] = translation
        try:
            response = await self._client.get("/v1/random", params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord could not pick a random verse: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return RandomVerse.parse_concord(response.json())

    async def keyword_search(
        self,
        q: str,
        translations: list[str] | None = None,
        book: str | None = None,
        limit: int = 20,
    ) -> KeywordSearchResponse:
        """Search Scripture for an exact word/phrase via Concord's `/v1/search` — the literal-text
        counterpart to semantic search (no embedding model involved). Searches **all loaded
        translations** by default (`translations=*`); pass a list to narrow to a subset. Each hit
        then carries a `matches` map (translation id → highlighted snippet) for the translations
        where that verse matched. A 400/404/422 (bad query / unknown translation or book) is a
        client error, not unreachability."""
        # `translations=*` is Concord's "all loaded translations"; a list narrows to a subset.
        params: dict[str, str] = {
            "q": q,
            "limit": str(limit),
            "translations": ",".join(translations) if translations else "*",
        }
        if book:
            params["book"] = book
        try:
            response = await self._client.get("/v1/search", params=params, timeout=_SEARCH_TIMEOUT)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404, 422):
                raise ConcordNotFoundError(
                    f"Concord could not run that search: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return KeywordSearchResponse.model_validate(response.json())

    async def get_chapter(self, book: str, chapter: int, translation: str) -> Chapter:
        """Read one chapter in one translation. A 404 (unknown book / no such chapter) is a
        real not-found, not unreachability — surfaced as ConcordNotFoundError."""
        try:
            response = await self._client.get(
                f"/v1/chapters/{book}/{chapter}", params={"translations": translation}
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ConcordNotFoundError(
                    f"Concord has no {book} {chapter} (in {translation})"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return Chapter.model_validate(response.json())

    async def get_cross_references(
        self, book: str, chapter: int, verse: int, translation: str | None = None
    ) -> CrossRefResponse:
        """Fetch the cross-references (TSK) for a verse from Concord — songbird owns no
        cross-reference data. `include_text=true` returns the target snippets in the same call.
        A 400/404 (bad/unknown reference) is a not-found, not unreachability."""
        params: dict[str, str] = {"include_text": "true", "limit": "20"}
        if translation:
            params["translation"] = translation
        ref = f"{book} {chapter}:{verse}"
        try:
            response = await self._client.get(
                f"/v1/cross-references/{quote(ref, safe='')}", params=params
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord could not resolve '{ref}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return CrossRefResponse.model_validate(response.json())

    async def get_verse_topics(self, book: str, chapter: int, verse: int) -> VerseTopicsResponse:
        """The topics a verse appears under, from Concord's curated topical index (songbird owns
        none). No `include_text` — topics are just id/name/section. A 400/404 (bad/unknown
        reference) is a not-found, not unreachability."""
        ref = f"{book} {chapter}:{verse}"
        try:
            response = await self._client.get(f"/v1/verses/{quote(ref, safe='')}/topics")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord could not resolve '{ref}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return VerseTopicsResponse.model_validate(response.json())

    async def get_topic_verses(
        self, topic_id: str, translation: str | None = None, limit: int = 50, offset: int = 0
    ) -> TopicVersesResponse:
        """The verses curated under a topic, from Concord (songbird owns no topic data).
        `include_text=true` returns the verse snippets in the same call (with `translation` when
        given), so the drill-in can show verse text. A 400/404 (unknown topic) is a not-found,
        not unreachability."""
        params: dict[str, str] = {
            "include_text": "true",
            "limit": str(limit),
            "offset": str(offset),
        }
        if translation:
            params["translation"] = translation
        try:
            response = await self._client.get(
                f"/v1/topics/{quote(topic_id, safe='')}/verses", params=params
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no topic '{topic_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return TopicVersesResponse.model_validate(response.json())

    async def list_topics(
        self,
        q: str | None = None,
        section: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> TopicsResponse:
        """One page of the topical index browse (`/v1/topics`) — filter by name (`q`) / section,
        paginated. A 400/404 (e.g. unknown section filter) is a client error, not unreachability."""
        params: dict[str, str] = {"limit": str(limit), "offset": str(offset)}
        if q:
            params["q"] = q
        if section:
            params["section"] = section
        try:
            response = await self._client.get("/v1/topics", params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord could not run that topics query: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return TopicsResponse.model_validate(response.json())

    async def get_topic(self, topic_id: str) -> TopicDetail:
        """A single topic's full detail (`/v1/topics/{id}`), including `see_also` + `verse_count`.
        A 400/404 is a real not-found, not unreachability."""
        try:
            response = await self._client.get(f"/v1/topics/{quote(topic_id, safe='')}")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no topic '{topic_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return TopicDetail.model_validate(response.json())

    async def get_verse_words(self, book: str, chapter: int, verse: int) -> VerseWordsResponse:
        """A verse's tagged original-language tokens, from Concord (songbird owns no text). No
        `text` param — Concord auto-selects Hebrew/Greek by testament. A 400/404 (bad ref) is a
        not-found; a VALID ref with no tagged original is a normal empty 200 (tokens: []), not an
        error."""
        ref = f"{book} {chapter}:{verse}"
        try:
            response = await self._client.get(f"/v1/verses/{quote(ref, safe='')}/words")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord could not resolve '{ref}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return VerseWordsResponse.model_validate(response.json())

    async def get_strongs(self, strongs_id: str) -> StrongsDetail:
        """A single Strong's lexicon entry (`/v1/strongs/{id}`), the lexical payoff. A 400/404
        (unknown id) is a real not-found, not unreachability."""
        try:
            response = await self._client.get(f"/v1/strongs/{quote(strongs_id, safe='')}")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no Strong's entry '{strongs_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return StrongsDetail.model_validate(response.json())

    async def get_strongs_verses(
        self, strongs_id: str, translation: str | None = None, limit: int = 50, offset: int = 0
    ) -> StrongsVersesResponse:
        """The verses where a Strong's number occurs (the concordance), from Concord.
        `include_text=true` returns the verse snippets (with `translation` when given). A 400/404
        (unknown id) is a not-found, not unreachability."""
        params: dict[str, str] = {
            "include_text": "true",
            "limit": str(limit),
            "offset": str(offset),
        }
        if translation:
            params["translation"] = translation
        try:
            response = await self._client.get(
                f"/v1/strongs/{quote(strongs_id, safe='')}/verses", params=params
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no Strong's entry '{strongs_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return StrongsVersesResponse.model_validate(response.json())

    async def list_journeys(self, limit: int = 50, offset: int = 0) -> JourneysResponse:
        """One page of the curated journeys (`/v1/journeys`), paginated. No filters — the endpoint
        takes only limit/offset. A 400/404 is a client error, not unreachability."""
        params: dict[str, str] = {"limit": str(limit), "offset": str(offset)}
        try:
            response = await self._client.get("/v1/journeys", params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord could not list journeys: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return JourneysResponse.model_validate(response.json())

    async def get_journey(self, journey_id: str) -> JourneyDetail:
        """A single journey's full detail (`/v1/journeys/{id}`), including its ordered stops, the
        `source`, and the one-reconstruction `note`. A 400/404 is a real not-found."""
        try:
            response = await self._client.get(f"/v1/journeys/{quote(journey_id, safe='')}")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no journey '{journey_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return JourneyDetail.model_validate(response.json())

    async def get_place_journeys(self, place_id: str) -> PlaceJourneysResponse:
        """The journeys that pass through a place (`/v1/places/{id}/journeys`) — the inverse
        lookup. A 400/404 (unknown place) is a not-found, not unreachability."""
        try:
            response = await self._client.get(f"/v1/places/{quote(place_id, safe='')}/journeys")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no place '{place_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return PlaceJourneysResponse.model_validate(response.json())

    async def get_places(self, book: str, chapter: int) -> VersePlacesResponse:
        """Places named in a chapter, from Concord (songbird owns no place data). Carries the
        honesty model through — unknown/symbolic places have null coordinates."""
        ref = f"{book} {chapter}"
        try:
            response = await self._client.get(f"/v1/verses/{quote(ref, safe='')}/places")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord could not resolve '{ref}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return VersePlacesResponse.model_validate(response.json())

    async def list_places(
        self,
        type: str | None = None,
        status: str | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PlacesPage:
        """One page of the whole gazetteer (`/v1/places`) — filter by type/status/name, paginated.
        Honesty model carried through. A 400/404 (e.g. unknown type/status filter) is a client
        error, not unreachability."""
        params: dict[str, str] = {"limit": str(limit), "offset": str(offset)}
        if type:
            params["type"] = type
        if status:
            params["status"] = status
        if q:
            params["q"] = q
        try:
            response = await self._client.get("/v1/places", params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord could not run that places query: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return PlacesPage.model_validate(response.json())

    async def get_place(self, place_id: str) -> PlaceDetail:
        """A single place's full record (`/v1/places/{id}`). A 404 is a real not-found."""
        try:
            response = await self._client.get(f"/v1/places/{quote(place_id, safe='')}")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no place '{place_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return PlaceDetail.model_validate(response.json())

    async def list_place_types(self) -> list[str]:
        """The gazetteer's `type` vocabulary, derived from Concord rather than hardcoded (so it
        never goes stale as Concord adds types). Concord has no list-types endpoint, but rejects an
        unknown `type` with `{error: {detail: {available: [...]}}}` — we read it. Best-effort: any
        failure (or a Concord that stops surfacing the list) yields `[]`, and the UI hides the type
        filter rather than showing a stale or broken one."""
        try:
            response = await self._client.get(
                "/v1/places", params={"type": "__songbird_probe__", "limit": "1"}
            )
        except httpx.HTTPError:
            return []
        if response.status_code == 200:
            return []  # no error → no `available` list to read; hide the filter
        try:
            available = response.json()["error"]["detail"]["available"]
        except (ValueError, KeyError, TypeError):
            return []
        if not isinstance(available, list):
            return []
        items: list[Any] = available
        return [t for t in items if isinstance(t, str)]

    async def get_notes(self, translation: str, book: str, chapter: int) -> NotesResponse:
        """Translator's notes for a whole chapter in one translation, from Concord (songbird
        owns no notes). A known translation with no notes is a normal empty 200, not an error;
        a 400/404 (unknown translation/book) is a not-found, not unreachability."""
        try:
            response = await self._client.get(
                f"/v1/translations/{quote(translation, safe='')}"
                f"/notes/{quote(book, safe='')}/{chapter}"
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord has no notes for {book} {chapter} (in {translation})"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return NotesResponse.model_validate(response.json())

    async def get_asset(
        self, translation: str, name: str, *, if_none_match: str | None = None
    ) -> ConcordAsset:
        """One of a translation's images (a chart's picture) from Concord's
        `/v1/translations/{translation}/assets/{name}` (ADR-0012) — songbird stores none. The
        browser's `If-None-Match` is forwarded, and Concord's 304 comes back as `not_modified`
        (handled before `raise_for_status`, which raises on any 3xx). A 404 — an unknown
        translation or a name it lacks, whatever its shape — is a not-found; anything else is
        unreachability."""
        headers = {"If-None-Match": if_none_match} if if_none_match else None
        try:
            response = await self._client.get(
                f"/v1/translations/{quote(translation, safe='')}/assets/{quote(name, safe='')}",
                headers=headers,
            )
            if response.status_code != 304:
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ConcordNotFoundError(
                    f"Concord has no image '{name}' (in {translation})"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        not_modified = response.status_code == 304
        content_type = response.headers.get("content-type")
        return ConcordAsset(
            not_modified=not_modified,
            content=b"" if not_modified else response.content,
            media_type=content_type.split(";")[0].strip().lower() if content_type else None,
            etag=response.headers.get("etag"),
            cache_control=response.headers.get("cache-control"),
            vary=response.headers.get("vary"),
        )

    async def list_documents(
        self, translation: str, *, kind: str | None = None, book: str | None = None
    ) -> DocumentsResponse:
        """A translation's documents — book introductions and the like — from Concord's
        `/v1/translations/{translation}/documents` (ADR-0012); songbird stores none. A known
        translation with none is a normal empty 200. A 400 (an unknown kind or book) or a 404 (an
        unknown translation, or a Concord that predates documents) is a not-found, not
        unreachability."""
        params = {k: v for k, v in (("kind", kind), ("book", book)) if v is not None}
        try:
            response = await self._client.get(
                f"/v1/translations/{quote(translation, safe='')}/documents", params=params
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord has no such documents (in {translation})"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return DocumentsResponse.model_validate(response.json())

    async def get_document(self, translation: str, slug: str) -> Document:
        """One document by its slug, from Concord's
        `/v1/translations/{translation}/documents/{slug}` (ADR-0012); songbird stores none. A 404
        (an unknown translation or slug, or a Concord that predates documents) is a not-found;
        anything else is unreachability."""
        try:
            response = await self._client.get(
                f"/v1/translations/{quote(translation, safe='')}/documents/{quote(slug, safe='')}"
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord has no document '{slug}' (in {translation})"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return Document.model_validate(response.json())

    async def get_headings(self, translation: str, book: str, chapter: int) -> HeadingsResponse:
        """Section headings for a whole chapter in one translation, from Concord (songbird
        owns no headings). A known translation with no headings is a normal empty 200, not an
        error; a 400/404 (unknown translation/book) is a not-found, not unreachability."""
        try:
            response = await self._client.get(
                f"/v1/translations/{quote(translation, safe='')}"
                f"/headings/{quote(book, safe='')}/{chapter}"
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(
                    f"Concord has no headings for {book} {chapter} (in {translation})"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return HeadingsResponse.model_validate(response.json())

    async def search_notes(
        self,
        q: str,
        *,
        translation: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> NoteSearchResponse:
        """Keyword-search Concord's translator's/study notes via `/v1/notes/search` (v1.1.0), one
        page at a time: `limit` (Concord allows 1–100) from `offset`, optionally only one Bible's
        notes (`translation`). The `type` and `book` filters stay unused. Same error mapping and
        (slow-search) read budget as `keyword_search`: a 400/404/422 (an FTS5-unrunnable query, a
        Bible Concord doesn't hold) is not-found, anything else unreachable."""
        params = {"q": q, "limit": str(limit), "offset": str(offset)}
        if translation:
            params["translation"] = translation
        try:
            response = await self._client.get(
                "/v1/notes/search",
                params=params,
                timeout=_SEARCH_TIMEOUT,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404, 422):
                raise ConcordNotFoundError(
                    f"Concord could not run that notes search: {exc.response.status_code}"
                ) from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return NoteSearchResponse.model_validate(response.json())

    async def get_place_verses(self, place_id: str) -> PlaceVersesResponse:
        """The verses that mention a place (canonical coords → jump reuses navigation)."""
        try:
            response = await self._client.get(
                f"/v1/places/{quote(place_id, safe='')}/verses",
                params={"include_text": "false", "limit": "200"},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord has no place '{place_id}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return PlaceVersesResponse.model_validate(response.json())

    async def resolve_reference(self, ref: str) -> Chapter:
        """Resolve a raw human reference ("John 3", "Gen 1:1", "1 Cor 13") to canonical
        coordinates by delegating to Concord's resolver — songbird never parses references
        itself. Concord returns 400 for an unparseable reference and 404 for an unknown
        book / out-of-range chapter; both are a "couldn't find that reference" (not
        unreachability), so both surface as ConcordNotFoundError."""
        try:
            response = await self._client.get(f"/v1/verses/{quote(ref, safe='')}")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (400, 404):
                raise ConcordNotFoundError(f"Concord could not resolve '{ref}'") from exc
            raise ConcordUnreachableError(self._base_url, exc) from exc
        except httpx.HTTPError as exc:
            raise ConcordUnreachableError(self._base_url, exc) from exc
        return Chapter.model_validate(response.json())
