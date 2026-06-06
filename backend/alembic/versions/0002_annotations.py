"""annotations + users — songbird's own data model (Slice 1)

Creates the `users` and `annotations` tables and seeds a single default author. Annotation
anchors are canonical coordinates (book_usfm + chapter + verse range), never a
translation-specific id (CLAUDE.md invariant 4).

Revision ID: 0002_annotations
Revises: 0001_baseline
Create Date: 2026-06-05

"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0002_annotations"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "annotations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("book_usfm", sa.String(length=3), nullable=False),
        sa.Column("start_chapter", sa.Integer(), nullable=False),
        sa.Column("start_verse", sa.Integer(), nullable=False),
        sa.Column("end_chapter", sa.Integer(), nullable=False),
        sa.Column("end_verse", sa.Integer(), nullable=False),
        sa.Column("note_markdown", sa.Text(), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("scope_type", sa.String(length=16), nullable=False, server_default="all"),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_annotations_anchor",
        "annotations",
        ["book_usfm", "start_chapter", "end_chapter"],
    )

    # Seed the single default author (auth is Slice 8).
    op.bulk_insert(
        sa.table(
            "users",
            sa.column("id", sa.Integer),
            sa.column("name", sa.String),
            sa.column("created_at", sa.DateTime(timezone=True)),
        ),
        [{"id": 1, "name": "default", "created_at": datetime.now(UTC)}],
    )


def downgrade() -> None:
    op.drop_index("ix_annotations_anchor", table_name="annotations")
    op.drop_table("annotations")
    op.drop_table("users")
