"""songbird's own ORM models — annotations + a (single, for now) author.

The load-bearing rule (CLAUDE.md invariant 4): an annotation's anchor is **canonical
coordinates** — USFM book code + chapter + verse, as a range — never a translation-specific
id. No Bible text is stored here (invariant 5); notes are Markdown (invariant 6).
"""

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from songbird.db.base import Base

# Many-to-many join between annotations and tags (tags are songbird-owned; Concord never hears
# about them).
annotation_tags = Table(
    "annotation_tags",
    Base.metadata,
    Column(
        "annotation_id",
        Integer,
        ForeignKey("annotations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_annotation_tags_tag", "tag_id"),
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """An author / login. Multi-user-ready since Slice 1; Slice 8 turns auth on. `username` and
    `password_hash` are nullable because the original seeded default user is *unclaimed* until
    the first registration claims it (preserving its existing annotations)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    username: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )


class UserSession(Base):
    """A logged-in session: a random token (in an httponly cookie) → user, with expiry.
    Server-side source of truth, so logout truly revokes."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


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

    # Three-tier scope (SPEC §2): "all" (default), "current", "subset". For "current"/"subset"
    # the concrete translation codes live in `annotation_translations`; "all" has none.
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

    translations: Mapped[list["AnnotationTranslation"]] = relationship(
        back_populates="annotation",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    tags: Mapped[list["Tag"]] = relationship(secondary=annotation_tags, lazy="selectin")

    @property
    def scope_translations(self) -> list[str]:
        """The concrete translation codes this annotation is scoped to ([] for 'all')."""
        return [t.translation_code for t in self.translations]


class Tag(Base):
    """A free-form tag (songbird-owned). Names are normalized (trimmed + lowercased) and
    unique; many-to-many with annotations via `annotation_tags`."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)


class AnnotationTranslation(Base):
    """A translation code an annotation is scoped to (for 'current'/'subset' scope). Codes
    match Concord's translation ids (e.g. KJV, WEB). Empty set ⇒ 'all'-scope."""

    __tablename__ = "annotation_translations"
    __table_args__ = (
        UniqueConstraint("annotation_id", "translation_code", name="uq_annotation_translation"),
        Index("ix_annotation_translations_annotation", "annotation_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annotation_id: Mapped[int] = mapped_column(
        ForeignKey("annotations.id", ondelete="CASCADE"), nullable=False
    )
    translation_code: Mapped[str] = mapped_column(String(16), nullable=False)

    annotation: Mapped["Annotation"] = relationship(back_populates="translations")
