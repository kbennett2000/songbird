"""songbird's thin pass-through to Concord reads.

Slice 0's end-to-end proof: the SPA calls songbird, songbird calls Concord over HTTP, the
result flows back. The frontend never talks to Concord directly — songbird owns one coherent
API surface (this is where annotation overlay attaches in later slices).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response

from songbird.api.deps import get_concord_client
from songbird.concord.client import (
    ConcordAsset,
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.concord.schemas import Document, DocumentsResponse, TranslationsResponse
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["concord"])

# The only media types songbird will serve from its own origin as a translation's image — what
# Concord's loader accepts (ADR-0012). Anything else Concord might send (HTML, SVG, script) is
# refused rather than relayed to a page holding the user's session.
_IMAGE_TYPES = frozenset({"image/jpeg", "image/png"})


@router.get("/translations", response_model=TranslationsResponse)
async def list_translations(
    concord: ConcordClient = Depends(get_concord_client),
) -> TranslationsResponse:
    try:
        translations = await concord.list_translations()
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return TranslationsResponse(translations=translations)


def _private(cache_control: str) -> str:
    """Concord's Cache-Control with `public` made `private`. Concord serves images to anyone;
    songbird serves them only behind its login, so a shared cache between the browser and songbird
    must not keep one for someone who isn't signed in. The browser's own caching — a year,
    immutable — is unchanged (Kris's call, v1.8 slice B)."""
    directives = [d.strip() for d in cache_control.split(",") if d.strip()]
    kept = [d for d in directives if d.lower() not in ("public", "private")]
    return ", ".join(["private", *kept])


def _image_headers(asset: ConcordAsset) -> dict[str, str]:
    headers = {"X-Content-Type-Options": "nosniff"}
    if asset.etag:
        headers["ETag"] = asset.etag
    if asset.cache_control:
        headers["Cache-Control"] = _private(asset.cache_control)
    if asset.vary:
        headers["Vary"] = asset.vary
    return headers


@router.get(
    "/translations/{translation}/assets/{name}",
    response_class=Response,
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}}},
        304: {"description": "The browser's copy (by ETag) is current"},
    },
)
async def translation_asset(
    translation: str,
    name: str,
    if_none_match: Annotated[str | None, Header()] = None,
    concord: ConcordClient = Depends(get_concord_client),
) -> Response:
    """One of a translation's images — a chart's picture — passed through from Concord at
    request time (ADR-0012). songbird stores none of it (invariants 1 and 5): the bytes are read,
    sent, and dropped. Concord's ETag and caching pass through (with `public` made `private`), so
    the browser keeps the picture and a revalidation is a 304.

    A name Concord lacks is a 404, as is `.` / `..`, refused here before any call so neither can
    become a different Concord path. An unreachable Concord, or one answering with anything but a
    JPEG or PNG, is a 502 with no caching headers, so the browser keeps nothing and asking again
    really asks again."""
    if translation in (".", "..") or name in (".", ".."):
        raise_http(404, ErrorCode.NOT_FOUND, f"No image '{name}' in {translation}")
    try:
        asset = await concord.get_asset(translation, name, if_none_match=if_none_match)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    if asset.not_modified:
        return Response(status_code=304, headers=_image_headers(asset))
    if asset.media_type not in _IMAGE_TYPES:
        raise_http(
            502,
            ErrorCode.CONCORD_UNREACHABLE,
            f"Concord sent {asset.media_type or 'no media type'} for the image '{name}'",
        )
    return Response(
        content=asset.content, media_type=asset.media_type, headers=_image_headers(asset)
    )


@router.get("/translations/{translation}/documents", response_model=DocumentsResponse)
async def list_documents(
    translation: str,
    kind: Annotated[str | None, Query()] = None,
    book: Annotated[str | None, Query()] = None,
    concord: ConcordClient = Depends(get_concord_client),
) -> DocumentsResponse:
    """A translation's documents — its book introductions and the like — passed through from
    Concord at request time (ADR-0012), filtered by `kind` and `book`. songbird stores none of
    them (invariants 1 and 5). An unknown translation, kind or book, or a Concord that predates
    documents, is a 404; an unreachable Concord is a 502 (invariant 3)."""
    if translation in (".", ".."):
        raise_http(404, ErrorCode.NOT_FOUND, f"No documents in {translation}")
    try:
        return await concord.list_documents(translation, kind=kind, book=book)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))


@router.get("/translations/{translation}/documents/{slug}", response_model=Document)
async def get_document(
    translation: str,
    slug: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> Document:
    """One document — a book's introduction — passed through from Concord at request time:
    its Markdown text and the pictures it places, which the browser fetches through the assets
    route. songbird stores none of it (invariants 1 and 5). `.` and `..` are refused before any
    call, so neither can become a different Concord path; a slug Concord lacks is a 404, and an
    unreachable Concord a 502 (invariant 3)."""
    if translation in (".", "..") or slug in (".", ".."):
        raise_http(404, ErrorCode.NOT_FOUND, f"No document '{slug}' in {translation}")
    try:
        return await concord.get_document(translation, slug)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
