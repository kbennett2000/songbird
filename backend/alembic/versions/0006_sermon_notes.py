"""sermon_notes + sermon_note_tags — songbird-owned sermon notes (Slice 12)

A sermon note pins a sermon (title + URL body + date + tags) to a canonical verse span and is
always visible on every translation (no scope concept). Anchors are canonical coordinates
(book_usfm + chapter/verse range), never a translation-specific id (CLAUDE.md invariant 4); no
Scripture text is stored (invariant 5). Tags reuse the existing `tags` table. No data seed —
the ~213-row import is a separate later slice.

Revision ID: 0006_sermon_notes
Revises: 0005_auth
Create Date: 2026-06-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_sermon_notes"
down_revision: str | None = "0005_auth"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sermon_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("sermon_url", sa.Text(), nullable=False),
        sa.Column("reference", sa.String(length=128), nullable=False),
        sa.Column("book_usfm", sa.String(length=3), nullable=False),
        sa.Column("book_order_index", sa.Integer(), nullable=False),
        sa.Column("start_chapter", sa.Integer(), nullable=False),
        sa.Column("start_verse", sa.Integer(), nullable=False),
        sa.Column("end_chapter", sa.Integer(), nullable=False),
        sa.Column("end_verse", sa.Integer(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_sermon_notes_anchor",
        "sermon_notes",
        ["book_usfm", "start_chapter", "end_chapter"],
    )
    op.create_index("ix_sermon_notes_order", "sermon_notes", ["book_order_index"])

    op.create_table(
        "sermon_note_tags",
        sa.Column(
            "sermon_note_id",
            sa.Integer(),
            sa.ForeignKey("sermon_notes.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer(),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_sermon_note_tags_tag", "sermon_note_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_sermon_note_tags_tag", table_name="sermon_note_tags")
    op.drop_table("sermon_note_tags")
    op.drop_index("ix_sermon_notes_order", table_name="sermon_notes")
    op.drop_index("ix_sermon_notes_anchor", table_name="sermon_notes")
    op.drop_table("sermon_notes")
