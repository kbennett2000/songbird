"""Geography — places named in a passage, and the verses that name a place. Sourced entirely
from Concord (songbird stores no place data). Concord's honesty model (status + confidence +
nullable coordinates) is carried through faithfully — never a fabricated pin."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import Place, PlaceVerse
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
