"""sermon_sources + sermon_source_tags — where sermons come from (v1.7 sermon sources, slice 3)

A source is one YouTube channel or playlist the owner registered by pasting a link. The row holds
the address of that catalogue (the canonical id, the uploads playlist a later scan reads) plus how
the owner wants it filtered — not the videos, and certainly not any Scripture text (invariant 5).
The ledger of videos a scan has seen is a separate table in a later slice.

`min_minutes` is nullable on purpose: null means "follow SERMON_MIN_MINUTES", so raising the
app-wide floor reaches every source that never overrode it.

Tags reuse the existing `tags` table — one shared vocabulary across annotations, sermon notes and
sources, not three parallel sets.

Revision ID: 0011_sermon_sources
Revises: 0010_sermon_note_youtube_video_id
Create Date: 2026-09-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_sermon_sources"
down_revision: str | None = "0010_sermon_note_youtube_video_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sermon_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("youtube_id", sa.String(length=64), nullable=False),
        sa.Column("uploads_playlist_id", sa.String(length=64), nullable=True),
        sa.Column("input_url", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("include_live", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("min_minutes", sa.Integer(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_check_status", sa.Text(), nullable=True),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        # One author registers a given channel/playlist once. Scoped to the author, not global:
        # two users may well follow the same church.
        sa.UniqueConstraint("author_id", "youtube_id", name="uq_sermon_source_author_youtube"),
    )
    op.create_index("ix_sermon_sources_author", "sermon_sources", ["author_id"])

    op.create_table(
        "sermon_source_tags",
        sa.Column(
            "source_id",
            sa.Integer(),
            sa.ForeignKey("sermon_sources.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer(),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_sermon_source_tags_tag", "sermon_source_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_sermon_source_tags_tag", table_name="sermon_source_tags")
    op.drop_table("sermon_source_tags")
    op.drop_index("ix_sermon_sources_author", table_name="sermon_sources")
    op.drop_table("sermon_sources")
