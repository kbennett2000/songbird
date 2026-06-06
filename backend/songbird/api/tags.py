"""The tag list — feeds the editor's type-ahead autocomplete. Concord-free (tags are
songbird's own domain)."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.api.deps import get_db
from songbird.db.models import Tag

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])


@router.get("", response_model=list[str])
async def list_tags(db: AsyncSession = Depends(get_db)) -> list[str]:
    names = (await db.execute(select(Tag.name).order_by(Tag.name))).scalars().all()
    return list(names)
