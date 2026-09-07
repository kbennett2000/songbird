"""sermon_notes.source_video_id — the ledger row a note came from (v1.7 slice 4b)

Slice 4a wrote the ledger: one row per video a check has seen, and what songbird decided about it.
This is the link the other way. When a check reads a passage out of a video's own text and creates
the sermon note, the note remembers which row made it, so the review list can show "placed → these
notes" instead of leaving a person to guess which of their notes a check was responsible for.

**Nullable, and it stays nullable.** Most sermon notes are made by hand and have no ledger row
behind them at all; a note created by a check outlives both the row and the source it came from,
because deleting where sermons came FROM must never delete the notes you wrote about them (spec
§9). `ON DELETE SET NULL` says exactly that.

**But SQLite will not do it**, twice over.

First, at runtime: the pragma that enforces foreign keys defaults to off and songbird never turns
it on, so the clause would be intent for any engine that honours it and nothing at all here — the
same trap 0012's `ON DELETE CASCADE` fell into. `delete_sermon_source` clears the column
explicitly before it clears the ledger, and a test holds it.

Second, at migration time, which is why **the column below carries no REFERENCES clause at all**.
SQLite cannot ALTER a constraint into an existing table, and both ways round it cost more than the
clause is worth:

* `op.add_column` with the foreign key emits a separate `ADD CONSTRAINT` that fails *after* the
  column has landed, leaving the migration half applied.
* `op.batch_alter_table` copies the table and moves it — but it refuses, because reflecting
  `sermon_notes` finds the unnamed foreign key to `users` that 0006 created and it cannot rebuild a
  constraint with no name. Naming it would rename an existing constraint on everyone's database,
  and the copy-and-move itself would rewrite every sermon note a person owns. Both are real risk
  for a clause SQLite ignores.

So the model declares the foreign key (it is the honest statement of what this column means, and a
real RDBMS would enforce it) and this migration adds a plain nullable integer. The two differ in
that one line and nowhere else; the enforcement that actually matters lives in the delete route.
The asymmetry is worth knowing: a foreign key declared inside `CREATE TABLE` is fine on SQLite —
0012 is full of them — and only an ALTER is not.

The index is not decoration. The ledger listing asks "which notes did these fifty rows create?" on
every page it serves, which is `source_video_id IN (…)`.

No Scripture text, no Concord involvement, songbird's own domain (invariant 5).

Revision ID: 0013_sermon_note_source_video
Revises: 0012_sermon_source_videos
Create Date: 2026-09-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_sermon_note_source_video"
down_revision: str | None = "0012_sermon_source_videos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # No sa.ForeignKey here — see the note above. The model carries it; SQLite could only be given
    # it by rewriting every row of this table.
    op.add_column("sermon_notes", sa.Column("source_video_id", sa.Integer(), nullable=True))
    op.create_index("ix_sermon_notes_source_video_id", "sermon_notes", ["source_video_id"])


def downgrade() -> None:
    op.drop_index("ix_sermon_notes_source_video_id", table_name="sermon_notes")
    op.drop_column("sermon_notes", "source_video_id")
