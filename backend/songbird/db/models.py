"""songbird's own ORM models — annotations + a (single, for now) author.

The load-bearing rule (CLAUDE.md invariant 4): an annotation's anchor is **canonical
coordinates** — USFM book code + chapter + verse, as a range — never a translation-specific
id. No Bible text is stored here (invariant 5); notes are Markdown (invariant 6).
"""

from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
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
    text,
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

    # The durable half of "Check now" (spec §6b): the button writes this down and answers 202, and
    # the background runner clears it when this source's check finishes. On disk rather than in
    # memory so a restart mid-scan still knows a check was asked for.
    check_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Whether the LAST check paged this source's catalogue all the way to its natural stop.
    #
    # It exists because the incremental stop rule — "stop at the first page where everything is
    # already known" — assumes every page above the stop is complete. A scan that committed page
    # one and then failed on page two leaves page one entirely known, so every future check stops
    # there and the rest of the catalogue becomes unreachable. Permanently, with no error.
    #
    # So a source pages everything unless its last scan finished. Written False with the first
    # batch's commit rather than in a `finally`, which is what also covers a kill -9 or a power
    # cut; written True only on a clean finish. Deliberately NOT derived from `last_check_status`:
    # that is a sentence shown to a person, and a copy edit must not change how a scan pages.
    scan_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    tags: Mapped[list["Tag"]] = relationship(secondary=sermon_source_tags, lazy="selectin")


class SermonSourceVideo(Base):
    """One video a check has seen, and what songbird decided about it (v1.7, spec §4, §6).

    The ledger: every video a scan looked at, whether it became a note or not. Bookkeeping for
    songbird's own decisions — the title and description a passage is read out of, the day it went
    up, how long it is — never a mirror of YouTube, and never Scripture text (invariant 5).

    It is also the checkpoint that makes a scan re-runnable: batches commit as they go, so a run
    that dies part way through leaves the finished ones finished and the next run skips them.

    `duration_seconds` is nullable and null is NOT zero — a video of unknown length has not earned
    the `too_short` reason (spec §6), so it falls through the length filter rather than into it.

    `status` and `skip_reason` are plain strings, like `SermonSource.kind`: the vocabulary is held
    in Python at both ends (the runner writes it, the API schema types it) rather than in a CHECK
    constraint SQLite could only change by rebuilding the table.

    Deleting a source takes its ledger with it (spec §9), but NOT through the `ondelete="CASCADE"`
    in the migration: songbird never turns SQLite's `PRAGMA foreign_keys` on, so that clause never
    fires. The DELETE route clears these rows explicitly — see `api/sermon_sources.py`.
    """

    __tablename__ = "sermon_source_videos"
    __table_args__ = (
        # "Have I seen this video?" is asked per AUTHOR, not per source: a church whose curated
        # playlist repeats its own uploads must not ledger the same sermon twice, and later note
        # it twice. A UNIQUE constraint IS an index in SQLite, so this doubles as the
        # (author_id, video_id) lookup index spec §4 asks for — hence no second one.
        UniqueConstraint("author_id", "video_id", name="uq_sermon_source_video_author_video"),
        Index("ix_sermon_source_videos_author_status", "author_id", "status"),
        Index("ix_sermon_source_videos_source_status", "source_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sermon_sources.id", ondelete="CASCADE"), nullable=False
    )
    # Denormalized from the source: one indexed lookup instead of a join on the scan's hot path.
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    # String(16) to match sermon_notes.youtube_video_id, which slice 4b compares this to.
    video_id: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # The text the passage rules read (spec §7). Bulk, and never sent to the browser.
    description: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)  # null = unknown
    is_live: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    # pending | needs_passage | placed | skipped | dismissed | already_noted
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", server_default="pending"
    )
    # too_short | live_excluded — set only when `status` is "skipped".
    skip_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # scripture_line | title | first_line | manual — which rule placed the note (spec §7).
    placed_by: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # References found deeper in the description, for the review list to offer as one-tap buttons
    # (spec §7 rule 4). ASSIGN A NEW LIST when changing this: a plain JSON column is not
    # mutation-tracked, so an in-place `.append()` would never reach the database.
    suggestions: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default=text("'[]'")
    )

    seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    # When this row stopped being `pending`. Null while it still is.
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
