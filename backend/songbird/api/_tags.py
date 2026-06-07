"""Shared tag helpers — songbird-owned (no Concord). Used by both the annotations and the
sermon-notes routers so the two share ONE tag vocabulary rather than parallel ones (the seed
mirrors this same normalization in ``songbird.seed.sermon_notes.normalize_tags``)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from songbird.db.models import Tag


def normalize_tags(names: list[str]) -> list[str]:
    """Trim + lowercase + de-dupe (order-preserving)."""
    return list(dict.fromkeys(n.strip().lower() for n in names if n.strip()))


async def resolve_tags(db: AsyncSession, names: list[str]) -> list[Tag]:
    """Get-or-create Tag rows for these names (songbird-owned; no Concord)."""
    normalized = normalize_tags(names)
    if not normalized:
        return []
    existing = (await db.execute(select(Tag).where(Tag.name.in_(normalized)))).scalars().all()
    by_name = {t.name: t for t in existing}
    resolved: list[Tag] = []
    for name in normalized:
        tag = by_name.get(name)
        if tag is None:
            tag = Tag(name=name)
            db.add(tag)
            by_name[name] = tag
        resolved.append(tag)
    return resolved
