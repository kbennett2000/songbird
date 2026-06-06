"""songbird's own ORM models — annotations + a (single, for now) author.

The load-bearing rule (CLAUDE.md invariant 4): an annotation's anchor is **canonical
coordinates** — USFM book code + chapter + verse, as a range — never a translation-specific
id. No Bible text is stored here (invariant 5); notes are Markdown (invariant 6).
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from songbird.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """An author. Multi-user-ready from line one; a single default row exists today
    (auth is Slice 8)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class Annotation(Base):
    """A note anchored to a canonical verse span. Single verse → start == end."""

    __tablename__ = "annotations"
    __table_args__ = (
        # Hot path: "all annotations for this book+chapter" (the chapter overlay).
        Index("ix_annotations_anchor", "book_usfm", "start_chapter", "end_chapter"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # The canonical anchor — never a translation-specific id (invariant 4).
    book_usfm: Mapped[str] = mapped_column(String(3), nullable=False)
    start_chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    start_verse: Mapped[int] = mapped_column(Integer, nullable=False)
    end_chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    end_verse: Mapped[int] = mapped_column(Integer, nullable=False)

    note_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Slice 1 ships "all translations" only; the 3-tier scope + subset table are Slice 2.
    scope_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="all", server_default="all"
    )

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )
