"""songbird's own ORM models — annotations + a (single, for now) author.

The load-bearing rule (CLAUDE.md invariant 4): an annotation's anchor is **canonical
coordinates** — USFM book code + chapter + verse, as a range — never a translation-specific
id. No Bible text is stored here (invariant 5); notes are Markdown (invariant 6).
"""

from datetime import UTC, date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from songbird.db.base import Base
from songbird.youtube.urls import youtube_video_id as extract_youtube_video_id

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

# Many-to-many join between sermon notes and the SAME songbird-owned tags (mirrors
# annotation_tags — one shared tag vocabulary across both note kinds).
sermon_note_tags = Table(
    "sermon_note_tags",
    Base.metadata,
    Column(
        "sermon_note_id",
        Integer,
        ForeignKey("sermon_notes.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_sermon_note_tags_tag", "tag_id"),
)

# Many-to-many join between sermon sources and those SAME tags (v1.7 sermon sources, spec §4).
# A third arm on one vocabulary, not a parallel set: a tag put on a channel is the same tag the
# annotations and sermon notes use, and `api/tags.py` counts all three as "in use".
sermon_source_tags = Table(
    "sermon_source_tags",
    Base.metadata,
    Column(
        "source_id",
        Integer,
        ForeignKey("sermon_sources.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_sermon_source_tags_tag", "tag_id"),
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
    # Where this user last read — the reader reopens to this position (per-profile, follows them
    # across browsers/devices). Just remembered coordinates (code "WEB", USFM "JHN", chapter 3);
    # not validated against Concord on write — the reader self-heals a stale value.
    last_translation: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_book: Mapped[str | None] = mapped_column(String(3), nullable=True)
    last_chapter: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # UI colour-scheme preference, per profile (#60): "light" | "dark" | "system". Null = follow
    # the OS until the user picks. songbird's own domain — no Concord involvement.
    theme: Mapped[str | None] = mapped_column(String(16), nullable=True)
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


class SermonNote(Base):
    """A sermon pinned to a canonical verse span (single verse → start == end). songbird-owned,
    like an annotation, and overlaid on the chapter the same way — but ALWAYS visible on every
    translation (no scope concept) and bodied by a sermon URL, not Markdown. Stores no Scripture
    text (invariant 5); the anchor is canonical coordinates (invariant 4)."""

    __tablename__ = "sermon_notes"
    __table_args__ = (
        # Hot path: "all sermon notes for this book+chapter" (the chapter overlay).
        Index("ix_sermon_notes_anchor", "book_usfm", "start_chapter", "end_chapter"),
        # Canonical-order listing (the ordering annotations lack).
        Index("ix_sermon_notes_order", "book_order_index"),
        # "have we already noted this video?" — the scan's dedupe check (v1.7 sermon sources).
        Index("ix_sermon_notes_youtube_video_id", "youtube_video_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    title: Mapped[str] = mapped_column(Text, nullable=False)
    sermon_url: Mapped[str] = mapped_column(Text, nullable=False)  # the body — an external link
    reference: Mapped[str] = mapped_column(String(128), nullable=False)  # e.g. "Acts 2:42-47"

    # The canonical anchor — never a translation-specific id (invariant 4). `book_usfm` is the
    # overlay match key (the USFM code Concord returns per chapter); `book_order_index` is
    # Concord's canonical_order, kept purely for canonical-order listing.
    book_usfm: Mapped[str] = mapped_column(String(3), nullable=False)
    book_order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    start_verse: Mapped[int] = mapped_column(Integer, nullable=False)
    end_chapter: Mapped[int] = mapped_column(Integer, nullable=False)
    end_verse: Mapped[int] = mapped_column(Integer, nullable=False)

    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # the sermon's date

    # The YouTube video this note links to, when `sermon_url` is a YouTube link (v1.7 sermon
    # sources). Derived, never client-supplied — see the validator below.
    youtube_video_id: Mapped[str | None] = mapped_column(String(16), nullable=True)

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    tags: Mapped[list["Tag"]] = relationship(secondary=sermon_note_tags, lazy="selectin")

    @validates("sermon_url")
    def _stamp_youtube_video_id(self, _key: str, value: str) -> str:
        """Keep `youtube_video_id` in step with `sermon_url` on every write.

        It lives here rather than in the routes because there are three places a sermon note is
        created — the POST route, the import, and the seed loader — plus the PATCH route's
        reassignment, and a helper called from each is a helper one of them will eventually
        forget. Setting it where the URL is set means the two cannot drift.

        SQLAlchemy does not fire validators when loading a row, so a value written directly to
        the column (the re-date back-fill) survives being read back. A bulk `update()` WOULD
        bypass this; nothing in songbird issues one.
        """
        self.youtube_video_id = extract_youtube_video_id(value)
        return value


class SermonSource(Base):
    """A YouTube channel or playlist to collect sermons from (v1.7 sermon sources, spec §4).

    Registered once by pasting a link: songbird resolves it through YouTube and stores the
    canonical id, the uploads playlist a later scan will read, and the title to show. No
    Scripture text and no video text lives here (invariant 5) — this row is only the address of
    a catalogue, plus how the owner wants it filtered.

    `min_minutes` is nullable ON PURPOSE: null means "follow SERMON_MIN_MINUTES", so raising the
    app-wide floor reaches every source that never overrode it. A stored copy of today's default
    would silently pin it.
    """

    __tablename__ = "sermon_sources"
    __table_args__ = (
        # One author can register a given channel/playlist once. Scoped to the author, not
        # global: two users may follow the same church.
        UniqueConstraint("author_id", "youtube_id", name="uq_sermon_source_author_youtube"),
        Index("ix_sermon_sources_author", "author_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # "channel" | "playlist"
    youtube_id: Mapped[str] = mapped_column(String(64), nullable=False)  # UC… or PL…
    # The UU… list every check reads. Channels only — a playlist IS its own catalogue.
    uploads_playlist_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_url: Mapped[str] = mapped_column(Text, nullable=False)  # what was pasted, for display
    title: Mapped[str] = mapped_column(Text, nullable=False)  # from YouTube, cached for display

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    # Past livestreams count as sermons — for most churches they ARE the sermons.
    include_live: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    min_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Written by the scan (slice 4); null until then, and the UI reads null as "never".
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_check_status: Mapped[str | None] = mapped_column(Text, nullable=True)

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    tags: Mapped[list["Tag"]] = relationship(secondary=sermon_source_tags, lazy="selectin")
