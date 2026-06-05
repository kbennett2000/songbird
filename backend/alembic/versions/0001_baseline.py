"""baseline — establishes the migration pipeline with no tables (Slice 0)

songbird's own feature tables (annotations, tags, users) arrive in later slices. This empty
baseline proves `alembic upgrade head` runs cleanly on a fresh data dir.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-06-05

"""

from collections.abc import Sequence

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
