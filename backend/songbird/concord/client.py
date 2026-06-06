"""The single HTTP client songbird uses to talk to Concord.

Routing every Concord call through this one class keeps the base URL and the
unreachable-handling in exactly one place (CLAUDE.md invariants 1–3): Concord is consumed
over HTTP at a configured URL, never embedded; when it is unreachable songbird raises a
clear error rather than falling back.
"""

from urllib.parse import quote

import httpx

from songbird.concord.schemas import (
    Book,
    BooksResponse,
    Chapter,
    ConcordHealth,
    CrossRefResponse,
    Translation,
    TranslationsResponse,
)


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


class ConcordClient:
    def __init__(
        self,
        base_url: str,
        timeout: float = 5.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout, transport=transport)

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
