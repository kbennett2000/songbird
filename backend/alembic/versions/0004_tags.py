"""tags + annotation_tags — free-form tags on annotations (Slice 4)

Tags are entirely songbird-owned (Concord never hears about them). No backfill — existing
annotations simply have no tags.

Revision ID: 0004_tags
Revises: 0003_annotation_translations
Create Date: 2026-06-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_tags"
down_revision: str | None = "0003_annotation_translations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("name", name="uq_tags_name"),
    )
    op.create_index("ix_tags_name", "tags", ["name"])

    op.create_table(
        "annotation_tags",
        sa.Column(
            "annotation_id",
            sa.Integer(),
            sa.ForeignKey("annotations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer(),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_annotation_tags_tag", "annotation_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_annotation_tags_tag", table_name="annotation_tags")
    op.drop_table("annotation_tags")
    op.drop_index("ix_tags_name", table_name="tags")
    op.drop_table("tags")
