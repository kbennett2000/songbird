"""Translator's notes — NET's tn/sn/tc/map footnotes for a passage. Sourced entirely from
Concord (songbird stores no notes). Notes are translation-specific (`char_offset` is a point
anchor into THAT translation's verse text); a translation with none returns an empty 200, not
an error — so the reader simply shows no markers. Mirrors the geography pass-through."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import NoteCrossReference, TranslatorNote
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["notes"])


@router.get("/notes/{translation}/{book}/{chapter}", response_model=list[TranslatorNote])
async def notes_in_chapter(
    translation: str,
    book: str,
    chapter: int,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[TranslatorNote]:
    try:
        result = await concord.get_notes(translation, book, chapter)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    # Pass Concord's notes through verbatim (canonical anchors + char_offset point anchors).
    return [
        TranslatorNote(
            book=n.book,
            chapter=n.chapter,
            verse=n.verse,
            reference=n.reference,
            type=n.type,
            text=n.text,
            char_offset=n.char_offset,
            marker=n.marker,
            ordinal=n.ordinal,
            cross_references=[
                NoteCrossReference(
                    to_book=x.to_book,
                    to_chapter=x.to_chapter,
                    to_verse_start=x.to_verse_start,
                    to_verse_end=x.to_verse_end,
                    reference=x.reference,
                )
                for x in n.cross_references
            ],
        )
        for n in result.notes
    ]
