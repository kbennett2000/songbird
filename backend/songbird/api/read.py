"""The chapter reader + the canonical-coordinate overlay (CLAUDE.md invariant 4).

songbird fetches a chapter from Concord (verses keyed by canonical coordinates), then overlays
its own annotations by matching on those same coordinates — in the backend, where the chapter
fetch and the annotation query meet. A note pinned to JHN 3:16 shows on verse 16 in *any*
translation, because it's anchored to the address, not the text.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_concord_client, get_db
from songbird.api.schemas import (
    AnnotationOut,
    CrossReference,
    ReadAnnotation,
    ReadChapter,
    ReadVerse,
    ResolvedReference,
)
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.concord.schemas import BooksResponse
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import Annotation

router = APIRouter(prefix="/api/v1", tags=["read"])


def _covers(ann: Annotation, chapter: int, verse: int) -> bool:
    """Does this annotation's canonical span cover (chapter, verse)? Range-ready; for a
    single-verse anchor this reduces to an exact (chapter, verse) match."""
    after_start = chapter > ann.start_chapter or (
        chapter == ann.start_chapter and verse >= ann.start_verse
    )
    before_end = chapter < ann.end_chapter or (
        chapter == ann.end_chapter and verse <= ann.end_verse
    )
    return after_start and before_end


def _in_scope(ann: Annotation, translation: str) -> bool:
    """Is this annotation in scope for the translation being read? 'all' is always in scope;
    'current'/'subset' are in scope iff the translation is among their codes. (Decision B:
    out-of-scope annotations are still shown, just marked — never hidden.)"""
    if ann.scope_type == "all":
        return True
    return translation.upper() in {c.upper() for c in ann.scope_translations}


@router.get("/books", response_model=BooksResponse)
async def list_books(
    concord: ConcordClient = Depends(get_concord_client),
) -> BooksResponse:
    try:
        books = await concord.list_books()
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return BooksResponse(books=books)


@router.get("/cross-references/{book}/{chapter}/{verse}", response_model=list[CrossReference])
async def cross_references(
    book: str,
    chapter: int,
    verse: int,
    translation: str | None = None,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[CrossReference]:
    """Cross-references (from Concord's TSK data) for a verse. songbird owns none of this —
    pure pass-through. Targets are canonical coords, so the reader jumps to them directly."""
    try:
        result = await concord.get_cross_references(book, chapter, verse, translation)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))

    return [
        CrossReference(
            book=entry.to.book,
            chapter=entry.to.chapter,
            verse_start=entry.to.verse_start,
            verse_end=entry.to.verse_end,
            reference=entry.to.reference,
            votes=entry.votes,
            text=entry.text,
        )
        for entry in result.cross_references
    ]


@router.get("/resolve", response_model=ResolvedReference)
async def resolve_reference(
    ref: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> ResolvedReference:
    """Resolve a raw human reference to canonical coordinates via Concord (songbird does not
    parse references itself). Unparseable / unknown reference → 404; Concord down → 502."""
    try:
        resolved = await concord.resolve_reference(ref)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, f"Couldn't find reference '{ref}': {exc}")
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))

    if not resolved.verses:
        raise_http(404, ErrorCode.NOT_FOUND, f"Couldn't find reference '{ref}'")

    first = resolved.verses[0]
    # Exactly one verse back ⇒ the reference named a specific verse (highlight it); more ⇒ a
    # chapter (just load it).
    verse = first.verse if len(resolved.verses) == 1 else None
    return ResolvedReference(
        reference=resolved.reference, book=first.book, chapter=first.chapter, verse=verse
    )


@router.get("/read/{translation}/{book}/{chapter}", response_model=ReadChapter)
async def read_chapter(
    translation: str,
    book: str,
    chapter: int,
    concord: ConcordClient = Depends(get_concord_client),
    db: AsyncSession = Depends(get_db),
) -> ReadChapter:
    try:
        chapter_data = await concord.get_chapter(book, chapter, translation)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))

    if not chapter_data.verses:
        raise_http(404, ErrorCode.NOT_FOUND, f"No verses for {book} {chapter}")

    # Canonical book code as Concord returns it (USFM) — the key the overlay matches on,
    # regardless of how `book` was spelled in the URL.
    book_usfm = chapter_data.verses[0].book

    result = await db.execute(
        select(Annotation).where(
            Annotation.book_usfm == book_usfm,
            Annotation.start_chapter <= chapter,
            Annotation.end_chapter >= chapter,
        )
    )
    annotations = list(result.scalars().all())

    resolved_translation = (
        chapter_data.translations[0] if chapter_data.translations else translation
    )

    def _to_read_annotation(a: Annotation) -> ReadAnnotation:
        base = AnnotationOut.model_validate(a)
        return ReadAnnotation(**base.model_dump(), in_scope=_in_scope(a, resolved_translation))

    verses: list[ReadVerse] = []
    for v in chapter_data.verses:
        # One translation was requested, so there is exactly one text value.
        text = next(iter(v.text.values()), None)
        overlay = [_to_read_annotation(a) for a in annotations if _covers(a, v.chapter, v.verse)]
        verses.append(
            ReadVerse(
                book=v.book,
                chapter=v.chapter,
                verse=v.verse,
                reference=v.reference,
                text=text,
                annotations=overlay,
            )
        )

    return ReadChapter(
        translation=resolved_translation,
        book=book_usfm,
        chapter=chapter,
        reference=chapter_data.reference,
        verses=verses,
    )
