"""sermon note youtube_video_id — the video a sermon note links to (v1.7 sermon sources)

Adds a nullable, indexed `youtube_video_id`, parsed from `sermon_url` whenever that URL is a
YouTube link. It is how a later catalogue scan knows a video was already noted by hand, so it
doesn't make a second note for it. Existing rows stay null until the re-date action back-fills
them. songbird's own domain — no Scripture text, no Concord involvement.

Revision ID: 0010_sermon_note_youtube_video_id
Revises: 0009_user_theme
Create Date: 2026-09-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_sermon_note_youtube_video_id"
down_revision: str | None = "0009_user_theme"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sermon_notes",
        sa.Column("youtube_video_id", sa.String(length=16), nullable=True),
    )
    op.create_index(
        "ix_sermon_notes_youtube_video_id", "sermon_notes", ["youtube_video_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_sermon_notes_youtube_video_id", table_name="sermon_notes")
    op.drop_column("sermon_notes", "youtube_video_id")
