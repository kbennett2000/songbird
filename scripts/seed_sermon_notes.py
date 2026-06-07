#!/usr/bin/env python3
"""One-time loader: soap-journal backup → songbird's ``sermon_notes`` table (Slice 14).

Copyright-free: this script is committed; the backup JSON is NOT. It carries no Scripture text
(the transform's row type has no text field). Run ``--dry-run`` first — the listing is the gate
before any write.

    cd backend && source .venv/bin/activate
    python ../scripts/seed_sermon_notes.py <backup.json> --dry-run   # report only, no write
    python ../scripts/seed_sermon_notes.py <backup.json>             # write
    python ../scripts/seed_sermon_notes.py <backup.json> --reset     # delete-then-reseed

The book map (canonical_order → USFM) is fetched LIVE from Concord — never hand-typed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, cast

import httpx

# Make the songbird package importable when run from the repo (backend/ holds it).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from songbird.config import get_settings  # noqa: E402
from songbird.db.models import SermonNote, Tag, User  # noqa: E402
from songbird.seed.sermon_notes import (  # noqa: E402
    SeedError,
    SermonNoteRow,
    build_book_map,
    count_urls,
    find_true_duplicate_entries,
    missing_book_indices,
    transform_entry,
)
from sqlalchemy import create_engine, delete, func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402


def _fetch_book_map(concord_base_url: str) -> dict[int, str]:
    try:
        resp = httpx.get(f"{concord_base_url.rstrip('/')}/v1/books", timeout=10.0)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise SeedError(f"could not reach Concord at {concord_base_url}: {exc}") from exc
    payload: Any = resp.json()
    books = cast("list[dict[str, Any]]", payload["books"])
    return build_book_map(books)


def _anchor_str(row: SermonNoteRow) -> str:
    span = (
        f"{row.start_chapter}:{row.start_verse}"
        if (row.start_chapter, row.start_verse) == (row.end_chapter, row.end_verse)
        else f"{row.start_chapter}:{row.start_verse}-{row.end_chapter}:{row.end_verse}"
    )
    return f"{row.book_usfm} {span}"


def _resolve_author(session: Session, requested: int | None) -> int:
    users = list(session.execute(select(User)).scalars().all())
    if requested is not None:
        if not any(u.id == requested for u in users):
            raise SeedError(f"--author-id {requested} does not exist")
        return requested
    if len(users) == 1:
        return users[0].id
    if not users:
        raise SeedError("no users exist — register one first")
    raise SeedError(
        f"{len(users)} users exist; pass --author-id to choose "
        f"(ids: {', '.join(str(u.id) for u in users)})"
    )


def _resolve_tag(session: Session, name: str, cache: dict[str, Tag]) -> Tag:
    if name in cache:
        return cache[name]
    tag = session.execute(select(Tag).where(Tag.name == name)).scalar_one_or_none()
    if tag is None:
        tag = Tag(name=name)
        session.add(tag)
        session.flush()
    cache[name] = tag
    return tag


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed sermon_notes from a soap-journal backup.")
    parser.add_argument("backup", type=Path, help="path to the soap-journal backup JSON")
    parser.add_argument("--dry-run", action="store_true", help="transform + report; write nothing")
    parser.add_argument(
        "--reset", action="store_true", help="delete the author's sermon_notes first, then insert"
    )
    parser.add_argument("--author-id", type=int, default=None, help="author for the rows")
    args = parser.parse_args()

    settings = get_settings()

    try:
        data: Any = json.loads(Path(args.backup).read_text(encoding="utf-8"))
        entries: list[dict[str, Any]] = data["entries"]
        print(f"Loaded {len(entries)} entries from {args.backup}")

        book_map = _fetch_book_map(settings.concord_base_url)
        print(f"Book map from Concord: {len(book_map)} books; tripwire OK (1=GEN, 44=ACT, 66=REV)")

        missing = missing_book_indices(entries, book_map)
        if missing:
            raise SeedError(f"book_order_index values absent from Concord's map: {missing}")

        # Partition by URL well-formedness (exactly one URL), then transform the good ones once.
        bad_url = [e for e in entries if count_urls(e.get("observation")) != 1]
        good = [e for e in entries if count_urls(e.get("observation")) == 1]
        per_entry = [(e, transform_entry(e, book_map)) for e in good]
        rows: list[SermonNoteRow] = [r for _, erows in per_entry for r in erows]
        multi = [(e, erows) for e, erows in per_entry if len(erows) > 1]
        cross_chapter = [r for r in rows if r.start_chapter != r.end_chapter]
        dupes = find_true_duplicate_entries(entries)
    except SeedError as exc:
        print(f"ABORT: {exc}", file=sys.stderr)
        return 2

    # ---- report (the gate) ----------------------------------------------------------------
    print("\n=== REPORT ===")
    print(f"(a) rows spanning >1 chapter (expect 0): {len(cross_chapter)}")
    for r in cross_chapter:
        print(f"      !! {_anchor_str(r)}  {r.title!r}")

    print(f"(b) source entries producing >1 row: {len(multi)}")
    for entry, erows in multi:
        ref = entry.get("scripture_ref")
        title = str(entry.get("title") or "")[:50]
        print(f"      {ref!r}  ({len(erows)} rows)  — {title!r}")
        for r in erows:
            print(f"         -> {_anchor_str(r)}   ref={r.reference!r}")

    print(f"(c) entries with !=1 URL in observation (expect 0): {len(bad_url)}")
    for e in bad_url:
        print(f"      {e.get('title','')[:60]!r} -> {str(e.get('observation'))[:60]!r}")

    print(f"true-duplicate (title+url) groups (NOT deleted): {len(dupes)}")
    for title, url in dupes:
        print(f"      {title[:60]!r}  {url}")

    print(f"\nwould insert {len(rows)} rows from {len(good)} entries")

    if args.dry_run:
        print("\n--dry-run: no rows written.")
        return 0
    if bad_url:
        print("ABORT: bad-URL entries present; fix the source first.", file=sys.stderr)
        return 2

    # ---- write ---------------------------------------------------------------------------
    db_url = f"sqlite:///{settings.data_dir / 'songbird.db'}"
    engine = create_engine(db_url, future=True)
    with Session(engine) as session:
        author_id = _resolve_author(session, args.author_id)
        existing = session.execute(
            select(func.count())
            .select_from(SermonNote)
            .where(SermonNote.author_id == author_id)
        ).scalar_one()
        if existing and not args.reset:
            print(
                f"ABORT: author {author_id} already has {existing} sermon_notes. "
                f"Re-run with --reset to replace them.",
                file=sys.stderr,
            )
            return 2
        if args.reset and existing:
            session.execute(delete(SermonNote).where(SermonNote.author_id == author_id))
            session.flush()
            print(f"--reset: deleted {existing} existing rows for author {author_id}")

        tag_cache: dict[str, Tag] = {}
        for r in rows:
            session.add(
                SermonNote(
                    title=r.title,
                    sermon_url=r.sermon_url,
                    reference=r.reference,
                    book_usfm=r.book_usfm,
                    book_order_index=r.book_order_index,
                    start_chapter=r.start_chapter,
                    start_verse=r.start_verse,
                    end_chapter=r.end_chapter,
                    end_verse=r.end_verse,
                    event_date=r.event_date,
                    author_id=author_id,
                    tags=[_resolve_tag(session, name, tag_cache) for name in r.tags],
                )
            )
        session.commit()
        total = session.execute(
            select(func.count()).select_from(SermonNote).where(SermonNote.author_id == author_id)
        ).scalar_one()
    print(f"Inserted {len(rows)} rows; author {author_id} now has {total} sermon_notes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
