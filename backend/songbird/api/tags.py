"""The tag list — feeds the editor's type-ahead autocomplete. Concord-free (tags are
songbird's own domain)."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_db
from songbird.db.models import Tag, annotation_tags, sermon_note_tags, sermon_source_tags

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])


@router.get("", response_model=list[str])
async def list_tags(db: AsyncSession = Depends(get_db)) -> list[str]:
    # Only tags still attached to an annotation, a sermon note or a sermon source — orphans left
    # behind when one is deleted or its tags replaced must not surface as filters or autocomplete.
    # All three arms read the SAME vocabulary (v1.7 spec §4), so a tag put on a channel is
    # offered by the type-ahead everywhere else too.
    # One `union(a, b)` call, not two chained: the first returns a CompoundSelect, which has no
    # `.union` of its own.
    used = select(annotation_tags.c.tag_id).union(
        select(sermon_note_tags.c.tag_id),
        select(sermon_source_tags.c.tag_id),
    )
    names = (
        (await db.execute(select(Tag.name).where(Tag.id.in_(used)).order_by(Tag.name)))
        .scalars()
        .all()
    )
    return list(names)
