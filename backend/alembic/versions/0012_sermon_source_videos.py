"""sermon_source_videos + the two scan columns — the ledger a check writes (v1.7 slice 4a)

A `sermon_sources` row is the ADDRESS of a catalogue. This is what songbird found there: one row
per video a check has seen, holding the bookkeeping its own decisions are made from — the title
and description a passage is read out of, the day it went up, how long it is — and what it
decided. Spec §4 authorises exactly that and no more: still no Scripture text (invariant 5), and
the video itself is never copied, only described.

The ledger is also the CHECKPOINT. A scan commits each batch as it goes, so a run that dies part
way through (quota gone, YouTube unreachable) leaves the finished ones finished and the next run
skips them. That is what makes "Check now" safe to press twice.

`(author_id, video_id)` is unique because the question every scan asks is "have I seen this
video?", not "have I seen it in this source?". A church whose curated playlist repeats its own
uploads must not get two ledger rows, and later two notes, for one sermon. A UNIQUE constraint IS
an index in SQLite, so it also serves as the lookup index spec §4 asks for.

`duration_seconds` is nullable and null is NOT zero: a video whose length YouTube withheld is of
unknown length, and filing it under `too_short` would record a reason it has not earned (spec §6).

`status` and `skip_reason` are plain strings with no CHECK constraint, like `sermon_sources.kind`.
The vocabulary grows over the next two slices and SQLite can only change a CHECK by rebuilding the
table; the words are held in Python at both ends instead — the runner writes them, and the API
schema types them as a Literal, so a wrong one fails loudly in one place rather than quietly in
the data.

Two columns land on `sermon_sources` as well:

* `check_requested_at` is the durable half of "Check now". The button writes it down and answers
  202; the background runner picks it up and clears it when that source's check finishes. A
  restart mid-scan loses nothing, because the request itself is on disk.
* `scan_complete` says whether the last check ran to its natural stop, and it exists because the
  incremental stop rule assumes every page above the stop is complete. A scan that committed page
  one and then died left a hole that page one would hide from every future check — permanently.
  So a source pages its whole catalogue unless its last scan finished. It is written False with
  the first batch's commit, which is what also covers a power cut.

`sermon_notes.source_video_id` — the link back from a note to the row that made it — is NOT here.
Nothing places a note yet; that column arrives with the slice that does.

Revision ID: 0012_sermon_source_videos
Revises: 0011_sermon_sources
Create Date: 2026-09-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_sermon_source_videos"
down_revision: str | None = "0011_sermon_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sermon_source_videos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "source_id",
            sa.Integer(),
            sa.ForeignKey("sermon_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Denormalized from the source so "have I seen this video?" and the review list are one
        # indexed lookup rather than a join on the hottest path in a scan.
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        # String(16) to match sermon_notes.youtube_video_id, which slice 4b compares this to.
        sa.Column("video_id", sa.String(length=16), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        # The text the passage rules read (spec §7). Bulk, and never sent to the browser.
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        # When a livestream actually began, which for a streamed service IS the service. Null for
        # an ordinary upload. Kept beside `published_at` because the two genuinely disagree — a
        # Sunday service streamed at 14:55 UTC and published at 04:32 the next morning is filed
        # under Monday by `publishedAt` alone (spec §7).
        sa.Column("actual_start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),  # null = unknown, not zero
        sa.Column("is_live", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
        sa.Column("skip_reason", sa.String(length=24), nullable=True),
        sa.Column("placed_by", sa.String(length=24), nullable=True),
        sa.Column("suggestions", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        # One row per video per author, whichever of their sources happened to see it first.
        sa.UniqueConstraint("author_id", "video_id", name="uq_sermon_source_video_author_video"),
    )
    # The review list reads (author, status); the per-source counts and the ledger filter read
    # (source, status). Two narrow indexes, each earning its keep.
    op.create_index(
        "ix_sermon_source_videos_author_status",
        "sermon_source_videos",
        ["author_id", "status"],
    )
    op.create_index(
        "ix_sermon_source_videos_source_status",
        "sermon_source_videos",
        ["source_id", "status"],
    )

    op.add_column(
        "sermon_sources",
        sa.Column("check_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    # False for every existing row, which is the honest answer: none of them has ever been
    # scanned, so none of them has a complete catalogue behind it.
    op.add_column(
        "sermon_sources",
        sa.Column("scan_complete", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("sermon_sources", "scan_complete")
    op.drop_column("sermon_sources", "check_requested_at")
    op.drop_index("ix_sermon_source_videos_source_status", table_name="sermon_source_videos")
    op.drop_index("ix_sermon_source_videos_author_status", table_name="sermon_source_videos")
    op.drop_table("sermon_source_videos")
