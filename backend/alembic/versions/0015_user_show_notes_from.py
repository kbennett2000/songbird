"""user show_notes_from — which Bibles' notes the reader shows on other translations (v1.8 slice A)

0014 gave each profile a NET-only toggle, `show_net_notes`, because NET was the only translation
Concord had notes for. Concord v8 lets a study Bible bring its own (the Every Man's Bible first),
so the toggle becomes a list of translation codes, one per "Show … notes" checkbox (ADR 0005).

**An existing choice is kept.** A profile with `show_net_notes = 1` gets `["NET"]`; every other
profile gets `[]`. Then `show_net_notes` is dropped. The downgrade reverses it: a list containing
"NET" becomes `show_net_notes = 1`, and any other code in the list (a choice 0014 couldn't express)
is lost.

The drop is a plain `op.drop_column`, as in every earlier downgrade: SQLite has run `ALTER TABLE …
DROP COLUMN` since 3.35, and `show_net_notes` carries no index, constraint or key that would stop it.

Only the preference lives here: the notes and each source's text come from Concord at request
time (invariants 1 and 5).

Revision ID: 0015_user_show_notes_from
Revises: 0014_user_show_net_notes
Create Date: 2026-10-01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_user_show_notes_from"
down_revision: str | None = "0014_user_show_net_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("show_notes_from", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.execute("UPDATE users SET show_notes_from = '[\"NET\"]' WHERE show_net_notes = 1")
    op.drop_column("users", "show_net_notes")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("show_net_notes", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.execute(
        "UPDATE users SET show_net_notes = 1 WHERE EXISTS "
        "(SELECT 1 FROM json_each(users.show_notes_from) WHERE json_each.value = 'NET')"
    )
    op.drop_column("users", "show_notes_from")
