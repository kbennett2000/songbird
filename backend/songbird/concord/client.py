"""The single HTTP client songbird uses to talk to Concord.

Routing every Concord call through this one class keeps the base URL and the
unreachable-handling in exactly one place (CLAUDE.md invariants 1–3): Concord is consumed
over HTTP at a configured URL, never embedded; when it is unreachable songbird raises a
clear error rather than falling back.
"""

import httpx

from songbird.concord.schemas import (
    Book,
    BooksResponse,
    Chapter,
    ConcordHealth,
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
