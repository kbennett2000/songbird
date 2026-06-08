"""user theme — per-profile light/dark mode preference (Issue #60)

Adds a nullable `theme` ("light" | "dark" | "system") so a user's colour-scheme choice follows
their profile across browsers/devices. Null = follow the OS until they pick. songbird's own
domain — no Concord involvement.

Revision ID: 0009_user_theme
Revises: 0008_user_last_position
Create Date: 2026-06-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_user_theme"
down_revision: str | None = "0008_user_last_position"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("theme", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "theme")
