"""user last_book + last_chapter — per-profile reading position (Issue #38)

Extends the remembered reader position beyond translation: adds nullable `last_book` (USFM code)
and `last_chapter` so the reader reopens to the exact chapter the user last read. songbird's own
domain — Concord stays user-unaware; a stale value self-heals in the reader.

Revision ID: 0008_user_last_position
Revises: 0007_user_last_translation
Create Date: 2026-06-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_user_last_position"
down_revision: str | None = "0007_user_last_translation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_book", sa.String(length=3), nullable=True))
    op.add_column("users", sa.Column("last_chapter", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_chapter")
    op.drop_column("users", "last_book")
