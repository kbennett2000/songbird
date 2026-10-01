"""Migration 0015 keeps an existing "Show NET notes" choice (v1.8 slice A, ADR 0005).

`show_net_notes` (a boolean, 0014) becomes `show_notes_from` (a list of translation codes). This
runs the real Alembic migrations on a scratch database: a profile with NET notes on must come out
with ["NET"], one with them off with [], and the downgrade must turn the list back into the
boolean. Alembic runs in a subprocess so its logging setup and songbird's cached settings stay out
of the rest of the suite.
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent


def _alembic(data_dir: Path, *args: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=_BACKEND,
        env={**os.environ, "DATA_DIR": str(data_dir)},
        check=True,
        capture_output=True,
    )


def _prefs(db: sqlite3.Connection, column: str) -> dict[str, object]:
    # Only this test's profiles: an earlier migration seeds a user named "default".
    rows = db.execute(f"SELECT name, {column} FROM users WHERE name != 'default'")
    return dict(rows.fetchall())


def _columns(db: sqlite3.Connection) -> set[str]:
    return {row[1] for row in db.execute("PRAGMA table_info(users)")}


def test_upgrade_keeps_a_net_choice_and_downgrade_restores_it(tmp_path: Path) -> None:
    _alembic(tmp_path, "upgrade", "0014_user_show_net_notes")
    path = tmp_path / "songbird.db"
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO users (name, created_at, show_net_notes) VALUES "
            "('net-on', '2026-01-01', 1), ('net-off', '2026-01-01', 0)"
        )

    _alembic(tmp_path, "upgrade", "head")
    with sqlite3.connect(path) as db:
        assert "show_net_notes" not in _columns(db)
        rows = _prefs(db, "show_notes_from")
        assert {name: json.loads(str(value)) for name, value in rows.items()} == {
            "net-on": ["NET"],
            "net-off": [],
        }
        # A choice 0014 couldn't express, to see what the downgrade does with it.
        db.execute(
            "INSERT INTO users (name, created_at, show_notes_from) VALUES "
            "('both', '2026-01-01', '[\"EMB\", \"NET\"]'), "
            "('emb-only', '2026-01-01', '[\"EMB\"]')"
        )
        # A new profile gets the empty list from the column's server default.
        db.execute("INSERT INTO users (name, created_at) VALUES ('new', '2026-01-01')")
        assert db.execute("SELECT show_notes_from FROM users WHERE name = 'new'").fetchone() == (
            "[]",
        )

    _alembic(tmp_path, "downgrade", "-1")
    with sqlite3.connect(path) as db:
        assert "show_notes_from" not in _columns(db)
        rows = _prefs(db, "show_net_notes")
        # NET in the list → on; anything else → off (EMB alone can't be said in 0014's terms).
        assert rows == {"net-on": 1, "net-off": 0, "both": 1, "emb-only": 0, "new": 0}

    # And forward again, from the restored boolean.
    _alembic(tmp_path, "upgrade", "head")
    with sqlite3.connect(path) as db:
        rows = _prefs(db, "show_notes_from")
        assert json.loads(str(rows["both"])) == ["NET"]
        assert json.loads(str(rows["emb-only"])) == []
