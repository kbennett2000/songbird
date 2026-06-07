"""Sermon notes — READ-ONLY this slice (creation + bulk seed come later). songbird-owned, like
annotations, but always visible on every translation (no scope) and bodied by a sermon URL.
Listed in canonical book order (the ordering annotations lack). Author-scoped (Slice 8)."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_current_user, get_db
from songbird.api.schemas import SermonNoteOut
from songbird.core.errors import ErrorCode, raise_http
from songbird.db.models import SermonNote, User

router = APIRouter(prefix="/api/v1/sermon-notes", tags=["sermon-notes"])


@router.get("", response_model=list[SermonNoteOut])
async def list_sermon_notes(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SermonNoteOut]:
    """The current user's sermon notes, in canonical book order (then chapter/verse)."""
    stmt = (
        select(SermonNote)
        .where(SermonNote.author_id == user.id)
        .order_by(
            SermonNote.book_order_index,
            SermonNote.start_chapter,
            SermonNote.start_verse,
            SermonNote.id,
        )
    )
    notes = (await db.execute(stmt)).scalars().unique().all()
    return [SermonNoteOut.model_validate(n) for n in notes]


@router.get("/{sermon_note_id}", response_model=SermonNoteOut)
async def get_sermon_note(
    sermon_note_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SermonNoteOut:
    # Scoped to the author: another user's note is a 404 (no existence leak).
    result = await db.execute(
        select(SermonNote).where(
            SermonNote.id == sermon_note_id, SermonNote.author_id == user.id
        )
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise_http(404, ErrorCode.NOT_FOUND, f"No sermon note {sermon_note_id}")
    return SermonNoteOut.model_validate(note)
