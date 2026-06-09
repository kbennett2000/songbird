"""Original-language word study — Concord's tagged Hebrew/Greek texts + Strong's lexicon +
concordance. songbird owns no original-language text, lexicon, or concordance; these routes pass
Concord's data through verbatim. Three reads back the reader: a verse's tokens, a Strong's entry,
and where that Strong's number occurs. Same proxy shape as topics — a bad ref/id is a not-found
(404), not unreachability (502). A valid verse with no tagged original is a normal empty 200."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import StrongsDetail, StrongsVerse, VerseWordsOut, WordTokenOut
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["word-study"])


@router.get("/verse-words/{book}/{chapter}/{verse}", response_model=VerseWordsOut)
async def verse_words(
    book: str,
    chapter: int,
    verse: int,
    concord: ConcordClient = Depends(get_concord_client),
) -> VerseWordsOut:
    """A verse's tagged original-language tokens. Carries `text_id` (so the client can pick RTL for
    Hebrew) — NOT a bare token list. A valid ref with no tagged original passes through as an empty
    token list (200), not an error. The client builds the canonical "{book} {chapter}:{verse}"
    ref."""
    try:
        result = await concord.get_verse_words(book, chapter, verse)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return VerseWordsOut(
        reference=result.reference,
        text_id=result.text_id,
        tokens=[
            WordTokenOut(
                position=t.position,
                surface_form=t.surface_form,
                strongs_id=t.strongs_id,
                morph_code=t.morph_code,
                lemma=t.lemma,
                transliteration=t.transliteration,
                gloss=t.gloss,
            )
            for t in result.tokens
        ],
    )


@router.get("/strongs/{strongs_id}", response_model=StrongsDetail)
async def strongs_detail(
    strongs_id: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> StrongsDetail:
    """One Strong's lexicon entry (lemma, definition, source). A 404 is a real not-found."""
    try:
        detail = await concord.get_strongs(strongs_id)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return StrongsDetail(
        strongs_id=detail.strongs_id,
        language=detail.language,
        lemma=detail.lemma,
        transliteration=detail.transliteration,
        gloss=detail.gloss,
        definition=detail.definition,
        source=detail.source,
    )


@router.get("/strongs/{strongs_id}/verses", response_model=list[StrongsVerse])
async def strongs_verses(
    strongs_id: str,
    translation: str | None = None,
    limit: int = 50,
    offset: int = 0,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[StrongsVerse]:
    """The verses where a Strong's number occurs (the concordance, with text). A bare list — LTR
    English, so no `text_id` needed. Canonical coords, so the reader jumps to them directly."""
    try:
        result = await concord.get_strongs_verses(strongs_id, translation, limit, offset)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        StrongsVerse(
            book=v.book,
            chapter=v.chapter,
            verse=v.verse,
            reference=v.reference,
            text=v.text,
        )
        for v in result.verses
    ]
