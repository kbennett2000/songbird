"""Geography — places named in a passage, and the verses that name a place. Sourced entirely
from Concord (songbird stores no place data). Concord's honesty model (status + confidence +
nullable coordinates) is carried through faithfully — never a fabricated pin."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import Place, PlaceDetail, PlacesPageOut, PlaceVerse
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["geography"])


@router.get("/places", response_model=list[Place])
async def places_in_chapter(
    book: str,
    chapter: int,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[Place]:
    try:
        result = await concord.get_places(book, chapter)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    # Carry the honesty fields through verbatim (null coords stay null).
    return [Place.model_validate(p, from_attributes=True) for p in result.places]


# --- Gazetteer (v1.4): browse the WHOLE place corpus, distinct from the per-chapter map above.
# `/places/browse` and `/place-types` are declared BEFORE `/places/{place_id}` so the literal paths
# win over the id matcher. The chapter-map `/places` endpoint above is left untouched.


@router.get("/places/browse", response_model=PlacesPageOut)
async def browse_places(
    type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    concord: ConcordClient = Depends(get_concord_client),
) -> PlacesPageOut:
    """Browse the whole gazetteer with optional type/status/name filters, paginated. Errors surface
    (this is a screen's primary content, not a best-effort sidecar): unreachable → 502, a bad
    filter → 404."""
    try:
        page = await concord.list_places(type=type, status=status, q=q, limit=limit, offset=offset)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    places = [Place.model_validate(p, from_attributes=True) for p in page.places]
    return PlacesPageOut(places=places, total=page.total)


@router.get("/place-types", response_model=list[str])
async def place_types(
    concord: ConcordClient = Depends(get_concord_client),
) -> list[str]:
    """The gazetteer's `type` vocabulary, derived from Concord (never hardcoded). Empty if Concord
    doesn't surface it — the UI then simply hides the type filter."""
    return await concord.list_place_types()


@router.get("/places/{place_id}", response_model=PlaceDetail)
async def place_detail(
    place_id: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> PlaceDetail:
    """One place's full record (honesty model + detail fields). A 404 is a real not-found."""
    try:
        detail = await concord.get_place(place_id)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return PlaceDetail.model_validate(detail, from_attributes=True)


@router.get("/places/{place_id}/verses", response_model=list[PlaceVerse])
async def place_verses(
    place_id: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[PlaceVerse]:
    try:
        result = await concord.get_place_verses(place_id)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        PlaceVerse(book=v.book, chapter=v.chapter, verse=v.verse, reference=v.reference)
        for v in result.verses
    ]
