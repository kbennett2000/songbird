"""user show_net_notes — per-profile toggle to show NET's translator's notes on other translations

Adds a boolean `show_net_notes` (default off). When on, the reader borrows NET's notes (fetched
from Concord at request time, never stored) and places them on the translation being read. The
column is only the preference — songbird still holds no Bible text or notes.

Revision ID: 0014_user_show_net_notes
Revises: 0013_sermon_note_source_video
Create Date: 2026-09-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_user_show_net_notes"
down_revision: str | None = "0013_sermon_note_source_video"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("show_net_notes", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "show_net_notes")
