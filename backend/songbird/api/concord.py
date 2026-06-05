"""songbird's thin pass-through to Concord reads.

Slice 0's end-to-end proof: the SPA calls songbird, songbird calls Concord over HTTP, the
result flows back. The frontend never talks to Concord directly — songbird owns one coherent
API surface (this is where annotation overlay attaches in later slices).
"""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.concord.client import ConcordClient, ConcordUnreachableError
from songbird.concord.schemas import TranslationsResponse
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["concord"])


@router.get("/translations", response_model=TranslationsResponse)
async def list_translations(
    concord: ConcordClient = Depends(get_concord_client),
) -> TranslationsResponse:
    try:
        translations = await concord.list_translations()
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return TranslationsResponse(translations=translations)
