"""Sermon notes — songbird-owned, like annotations, but ALWAYS visible on every translation
(no scope) and bodied by a sermon URL. Listed in canonical book order (the ordering annotations
lack). Author-scoped (Slice 8). Full CRUD: the anchor is canonical coordinates only (invariant 4)
and `book_order_index` is resolved from Concord at write time (never asserted by the client)."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api._tags import normalize_tags, resolve_tags
from songbird.api.deps import get_concord_client, get_current_user, get_db
from songbird.api.schemas import SermonNoteCreate, SermonNoteOut, SermonNoteUpdate
from songbird.concord.client import ConcordClient, ConcordUnreachableError
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, Tag, User

router = APIRouter(prefix="/api/v1/sermon-notes", tags=["sermon-notes"])


async def _resolve_book_order_index(book_usfm: str, concord: ConcordClient) -> int:
    """Map a USFM book code → Concord's canonical_order. Raises 422 for an unknown code, 502 if
    Concord can't be reached (it's a hard dependency — its absence is an error, invariant 3)."""
    code = book_usfm.strip().upper()
    try:
        books = await concord.list_books()
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    by_usfm = {b.id.upper(): b.canonical_order for b in books}
    order = by_usfm.get(code)
    if order is None:
        raise_http(422, ErrorCode.INVALID_BOOK, f"unknown book '{book_usfm}'")
    return order


async def _get_or_404(db: AsyncSession, sermon_note_id: int, author_id: int) -> SermonNote:
    # Scoped to the author: another user's note is a 404 (no existence leak).
    result = await db.execute(
        select(SermonNote).where(
            SermonNote.id == sermon_note_id, SermonNote.author_id == author_id
        )
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
    book_order_index = await _resolve_book_order_index(body.book_usfm, concord)
    note = SermonNote(
        title=body.title,
        sermon_url=body.sermon_url,
        reference=body.reference,
        book_usfm=body.book_usfm.strip().upper(),
        book_order_index=book_order_index,
        start_chapter=body.start_chapter,
        start_verse=body.start_verse,
        end_chapter=body.end_chapter,
        end_verse=body.end_verse,
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
    user: User = Depends(get_current_user),
) -> SermonNoteOut:
    note = await _get_or_404(db, sermon_note_id, user.id)
    if body.title is not None:
        note.title = body.title
    if body.sermon_url is not None:
        note.sermon_url = body.sermon_url
    if body.reference is not None:
        note.reference = body.reference
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
    await db.delete(note)
    await db.commit()
