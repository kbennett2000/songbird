"""user last_translation — per-profile reader default (Issue #20)

Adds a nullable `last_translation` code to users so the reader can open to the translation the
user last read in. Just a remembered string (e.g. "WEB"); songbird's own domain — Concord stays
user-unaware.

Revision ID: 0007_user_last_translation
Revises: 0006_sermon_notes
Create Date: 2026-06-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_user_last_translation"
down_revision: str | None = "0006_sermon_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_translation", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "last_translation")
