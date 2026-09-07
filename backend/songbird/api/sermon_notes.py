"""Sermon notes — songbird-owned, like annotations, but ALWAYS visible on every translation
(no scope) and bodied by a sermon URL. Listed in canonical book order (the ordering annotations
lack). Author-scoped (Slice 8). Full CRUD: the anchor is canonical coordinates only (invariant 4)
and `book_order_index` is resolved from Concord at write time (never asserted by the client)."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._anchors import resolve_anchor, resolve_book_order_index
from songbird.api._tags import normalize_tags, resolve_tags
from songbird.api.deps import get_concord_client, get_current_user, get_db
from songbird.api.schemas import SermonNoteCreate, SermonNoteOut, SermonNoteUpdate
from songbird.api.sermon_review import reopen_if_last_note
from songbird.concord.client import ConcordClient
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, Tag, User

router = APIRouter(prefix="/api/v1/sermon-notes", tags=["sermon-notes"])


async def _get_or_404(db: AsyncSession, sermon_note_id: int, author_id: int) -> SermonNote:
    # Scoped to the author: another user's note is a 404 (no existence leak).
    result = await db.execute(
        select(SermonNote).where(SermonNote.id == sermon_note_id, SermonNote.author_id == author_id)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise_http(404, ErrorCode.SERMON_NOTE_NOT_FOUND, f"No sermon note {sermon_note_id}")
    return note


@router.get("", response_model=list[SermonNoteOut])
async def list_sermon_notes(
    tags: str | None = None,
    match: str = "all",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SermonNoteOut]:
    """The current user's sermon notes, in canonical book order (then chapter/verse). `tags`
    filters by tag (`match=all` default → all the given tags; `any` → any), mirroring the
    annotations browse so the shared tag vocabulary narrows both note kinds together."""
    stmt = select(SermonNote).where(SermonNote.author_id == user.id)
    names = normalize_tags(tags.split(",")) if tags else []
    if names:
        stmt = stmt.join(SermonNote.tags).where(Tag.name.in_(names)).group_by(SermonNote.id)
        if match == "all":
            stmt = stmt.having(func.count(func.distinct(Tag.id)) == len(names))
    stmt = stmt.order_by(
        SermonNote.book_order_index,
        SermonNote.start_chapter,
        SermonNote.start_verse,
        SermonNote.id,
    )
    notes = (await db.execute(stmt)).scalars().unique().all()
    return [SermonNoteOut.model_validate(n) for n in notes]


@router.post("", response_model=SermonNoteOut, status_code=status.HTTP_201_CREATED)
async def create_sermon_note(
    body: SermonNoteCreate,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
    user: User = Depends(get_current_user),
) -> SermonNoteOut:
    span = await resolve_anchor(body.reference, concord)
    first, last = span.first, span.last
    book_order_index = await resolve_book_order_index(first.book, concord)
    note = SermonNote(
        title=body.title,
        sermon_url=body.sermon_url,
        reference=body.reference,
        book_usfm=first.book.strip().upper(),
        book_order_index=book_order_index,
        start_chapter=first.chapter,
        start_verse=first.verse,
        end_chapter=last.chapter,
        end_verse=last.verse,
        event_date=body.event_date,
        author_id=user.id,
        tags=await resolve_tags(db, body.tags),
    )
    db.add(note)
    await db.commit()  # expire_on_commit=False keeps the in-memory tags
    return SermonNoteOut.model_validate(note)


@router.get("/{sermon_note_id}", response_model=SermonNoteOut)
async def get_sermon_note(
    sermon_note_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonNoteOut:
    note = await _get_or_404(db, sermon_note_id, user.id)
    return SermonNoteOut.model_validate(note)


@router.patch("/{sermon_note_id}", response_model=SermonNoteOut)
async def update_sermon_note(
    sermon_note_id: int,
    body: SermonNoteUpdate,
    db: AsyncSession = Depends(get_db),
    concord: ConcordClient = Depends(get_concord_client),
    user: User = Depends(get_current_user),
) -> SermonNoteOut:
    note = await _get_or_404(db, sermon_note_id, user.id)
    if body.title is not None:
        note.title = body.title
    if body.sermon_url is not None:
        note.sermon_url = body.sermon_url
    if body.reference is not None:
        # Changing the reference re-anchors the note: re-resolve the canonical span so the
        # stored coverage always matches the displayed reference.
        span = await resolve_anchor(body.reference, concord)
        first, last = span.first, span.last
        note.reference = body.reference
        note.book_usfm = first.book.strip().upper()
        note.book_order_index = await resolve_book_order_index(first.book, concord)
        note.start_chapter = first.chapter
        note.start_verse = first.verse
        note.end_chapter = last.chapter
        note.end_verse = last.verse
    if body.event_date is not None:
        note.event_date = body.event_date
    if body.tags is not None:
        note.tags = await resolve_tags(db, body.tags)
    await db.commit()
    return SermonNoteOut.model_validate(note)


@router.delete("/{sermon_note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sermon_note(
    sermon_note_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    note = await _get_or_404(db, sermon_note_id, user.id)
    # Before the delete, because it has to count the notes that are NOT this one, and because a
    # video left marked `placed` with nothing behind it would be invisible in the review list.
    await reopen_if_last_note(db, note)
    await db.delete(note)
    await db.commit()
