"""annotation_translations — the subset table for the three-tier scope (Slice 2)

Holds the concrete translation codes an annotation is scoped to (for scope_type
'current' / 'subset'); 'all'-scope annotations have no rows. Existing rows are all 'all'-scope,
so no backfill is needed.

Revision ID: 0003_annotation_translations
Revises: 0002_annotations
Create Date: 2026-06-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_annotation_translations"
down_revision: str | None = "0002_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "annotation_translations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "annotation_id",
            sa.Integer(),
            sa.ForeignKey("annotations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("translation_code", sa.String(length=16), nullable=False),
        sa.UniqueConstraint("annotation_id", "translation_code", name="uq_annotation_translation"),
    )
    op.create_index(
        "ix_annotation_translations_annotation",
        "annotation_translations",
        ["annotation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_annotation_translations_annotation", table_name="annotation_translations")
    op.drop_table("annotation_translations")
