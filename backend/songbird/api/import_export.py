"""Import / export of songbird-owned notes (issue #41).

Export is a single portable JSON document (no ids/author/timestamps — account-agnostic); the
Markdown note bodies travel verbatim inside it (invariant 6). Import merges a document in,
**skipping exact duplicates** so a re-import is idempotent.

Concord is consulted ONCE per import to validate book codes + scope translations (invariant 3:
it's a hard dependency, its absence is a 502), after which resolution happens in memory — so a
large file is a single round-trip, not N. Creation reuses the same building blocks as the
annotation / sermon-note POST routes (`resolve_tags`, `AnnotationTranslation`, the canonical
`book_order_index`)."""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._tags import resolve_tags
from songbird.api.deps import get_concord_client, get_current_user, get_db
from songbird.api.schemas import (
    AnnotationExport,
    ExportDocument,
    ImportOutcome,
    ImportSummary,
    SermonNoteExport,
)
from songbird.concord.client import ConcordClient, ConcordUnreachableError
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import Annotation, AnnotationTranslation, SermonNote, User

router = APIRouter(prefix="/api/v1", tags=["import-export"])

# Dedupe keys — the natural identity of a note for "skip if already present". Two notes with the
# same anchor + content are the same note, regardless of id/timestamps.
AnnotationKey = tuple[str, int, int, int, int, str, str, tuple[str, ...]]
SermonKey = tuple[str, int, int, int, int, str, str, date | None]


def _norm_codes(codes: list[str]) -> list[str]:
    """Trim + uppercase + de-dupe scope codes (order-preserving) — mirrors `_resolve_scope`."""
    return list(dict.fromkeys(c.strip().upper() for c in codes if c.strip()))


def _annotation_key(
    book_usfm: str,
    start_chapter: int,
    start_verse: int,
    end_chapter: int,
    end_verse: int,
    note_markdown: str,
    scope_type: str,
    scope_translations: list[str],
) -> AnnotationKey:
    return (
        book_usfm.strip().upper(),
        start_chapter,
        start_verse,
        end_chapter,
        end_verse,
        note_markdown,
        scope_type,
        tuple(sorted(_norm_codes(scope_translations))),
    )


def _sermon_key(
    book_usfm: str,
    start_chapter: int,
    start_verse: int,
    end_chapter: int,
    end_verse: int,
    sermon_url: str,
    title: str,
    event_date: date | None,
) -> SermonKey:
    return (
        book_usfm.strip().upper(),
        start_chapter,
        start_verse,
        end_chapter,
        end_verse,
        sermon_url,
        title,
        event_date,
    )


@router.get("/export", response_model=ExportDocument)
async def export_notes(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExportDocument:
    """The current user's annotations + sermon notes as one portable document. Concord-free —
    these are songbird's own domain; the export carries only canonical coordinates + the notes."""
    ann_stmt = (
        select(Annotation)
        .where(Annotation.author_id == user.id)
        .order_by(
            Annotation.book_usfm,
            Annotation.start_chapter,
            Annotation.start_verse,
            Annotation.id,
        )
    )
    annotations = (await db.execute(ann_stmt)).scalars().unique().all()
    sn_stmt = (
        select(SermonNote)
        .where(SermonNote.author_id == user.id)
        .order_by(
            SermonNote.book_order_index,
            SermonNote.start_chapter,
            SermonNote.start_verse,
            SermonNote.id,
        )
    )
    sermon_notes = (await db.execute(sn_stmt)).scalars().unique().all()

    return ExportDocument(
        exported_at=datetime.now(UTC),
        annotations=[
            AnnotationExport(
                book_usfm=a.book_usfm,
                start_chapter=a.start_chapter,
                start_verse=a.start_verse,
                end_chapter=a.end_chapter,
                end_verse=a.end_verse,
                note_markdown=a.note_markdown,
                color=a.color,
                scope_type=a.scope_type,
                scope_translations=a.scope_translations,
                tags=[t.name for t in a.tags],
            )
            for a in annotations
        ],
        sermon_notes=[
            SermonNoteExport(
                title=n.title,
                sermon_url=n.sermon_url,
                reference=n.reference,
                book_usfm=n.book_usfm,
                start_chapter=n.start_chapter,
                start_verse=n.start_verse,
                end_chapter=n.end_chapter,
                end_verse=n.end_verse,
                event_date=n.event_date,
                tags=[t.name for t in n.tags],
            )
            for n in sermon_notes
        ],
    )


def _validate_scope(item: AnnotationExport, valid_codes: set[str]) -> tuple[list[str], str | None]:
    """In-memory mirror of `_resolve_scope` (annotations.py): returns (codes, error). A non-None
    error means the item is rejected (counted as failed), with a human-readable reason."""
    codes = _norm_codes(item.scope_translations)
    if item.scope_type == "all":
        return [], None
    if item.scope_type == "current" and len(codes) != 1:
        return [], "'current' scope needs exactly one translation"
    if item.scope_type == "subset" and not codes:
        return [], "'subset' scope needs at least one translation"
    if item.scope_type not in {"current", "subset"}:
        return [], f"unknown scope_type '{item.scope_type}'"
    unknown = [c for c in codes if c not in valid_codes]
    if unknown:
        return [], f"unknown translation(s): {', '.join(unknown)}"
    return codes, None


@router.post("/import", response_model=ImportSummary)
async def import_notes(
    document: ExportDocument,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
    user: User = Depends(get_current_user),
) -> ImportSummary:
    """Merge a previously-exported document into the current user's notes, skipping exact
    duplicates (idempotent). Validates against Concord once; an unreachable Concord is a 502."""
    # One Concord round-trip for the whole file (invariant 3 — a hard dependency).
    try:
        valid_codes = {t.id.upper() for t in await concord.list_translations()}
        order_by_usfm = {b.id.upper(): b.canonical_order for b in await concord.list_books()}
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))

    # Existing notes → dedupe-key sets (so a re-import skips, and the file self-dedupes too).
    existing_anns = (
        (await db.execute(select(Annotation).where(Annotation.author_id == user.id)))
        .scalars()
        .unique()
        .all()
    )
    ann_keys: set[AnnotationKey] = {
        _annotation_key(
            a.book_usfm,
            a.start_chapter,
            a.start_verse,
            a.end_chapter,
            a.end_verse,
            a.note_markdown,
            a.scope_type,
            a.scope_translations,
        )
        for a in existing_anns
    }
    existing_sermons = (
        (await db.execute(select(SermonNote).where(SermonNote.author_id == user.id)))
        .scalars()
        .unique()
        .all()
    )
    sermon_keys: set[SermonKey] = {
        _sermon_key(
            n.book_usfm,
            n.start_chapter,
            n.start_verse,
            n.end_chapter,
            n.end_verse,
            n.sermon_url,
            n.title,
            n.event_date,
        )
        for n in existing_sermons
    }

    summary = ImportSummary(annotations=ImportOutcome(), sermon_notes=ImportOutcome())

    for item in document.annotations:
        codes, error = _validate_scope(item, valid_codes)
        if error is not None:
            summary.annotations.failed += 1
            ref = f"{item.book_usfm} {item.start_chapter}:{item.start_verse}"
            summary.errors.append(f"annotation {ref}: {error}")
            continue
        key = _annotation_key(
            item.book_usfm,
            item.start_chapter,
            item.start_verse,
            item.end_chapter,
            item.end_verse,
            item.note_markdown,
            item.scope_type,
            codes,
        )
        if key in ann_keys:
            summary.annotations.skipped += 1
            continue
        db.add(
            Annotation(
                book_usfm=item.book_usfm.strip().upper(),
                start_chapter=item.start_chapter,
                start_verse=item.start_verse,
                end_chapter=item.end_chapter,
                end_verse=item.end_verse,
                note_markdown=item.note_markdown,
                color=item.color,
                scope_type=item.scope_type,
                author_id=user.id,
                translations=[AnnotationTranslation(translation_code=c) for c in codes],
                tags=await resolve_tags(db, item.tags),
            )
        )
        ann_keys.add(key)
        summary.annotations.created += 1

    for sn in document.sermon_notes:
        code = sn.book_usfm.strip().upper()
        order = order_by_usfm.get(code)
        if order is None:
            summary.sermon_notes.failed += 1
            summary.errors.append(f"sermon note '{sn.title}': unknown book '{sn.book_usfm}'")
            continue
        key = _sermon_key(
            sn.book_usfm,
            sn.start_chapter,
            sn.start_verse,
            sn.end_chapter,
            sn.end_verse,
            sn.sermon_url,
            sn.title,
            sn.event_date,
        )
        if key in sermon_keys:
            summary.sermon_notes.skipped += 1
            continue
        db.add(
            SermonNote(
                title=sn.title,
                sermon_url=sn.sermon_url,
                reference=sn.reference,
                book_usfm=code,
                book_order_index=order,
                start_chapter=sn.start_chapter,
                start_verse=sn.start_verse,
                end_chapter=sn.end_chapter,
                end_verse=sn.end_verse,
                event_date=sn.event_date,
                author_id=user.id,
                tags=await resolve_tags(db, sn.tags),
            )
        )
        sermon_keys.add(key)
        summary.sermon_notes.created += 1

    await db.commit()
    return summary
