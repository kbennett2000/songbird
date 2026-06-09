"""Section headings — a chapter's editorial passage titles ("The Creation", "The Beatitudes")
in one translation. Sourced entirely from Concord (songbird stores no headings); they're
per-translation editorial structure, not Scripture and not user content. A translation with
none returns an empty 200, not an error — so the reader simply shows no headings (and no
banner: a heading-less chapter is the normal state for many translations). Mirrors the notes
pass-through."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import SectionHeading
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["headings"])


@router.get("/headings/{translation}/{book}/{chapter}", response_model=list[SectionHeading])
async def headings_in_chapter(
    translation: str,
    book: str,
    chapter: int,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[SectionHeading]:
    try:
        result = await concord.get_headings(translation, book, chapter)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    # Pass Concord's headings through verbatim (canonical anchors + before_verse + ordinal).
    return [
        SectionHeading(
            book=h.book,
            chapter=h.chapter,
            before_verse=h.before_verse,
            text=h.text,
            ordinal=h.ordinal,
            reference=h.reference,
        )
        for h in result.headings
    ]
