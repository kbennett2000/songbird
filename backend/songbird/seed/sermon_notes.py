"""Pure transform for the one-time sermon-notes seed import (Slice 14).

Turns soap-journal backup entries into ``SermonNoteRow`` values ready to insert into the
``sermon_notes`` table. Deliberately copyright-free and Scripture-text-free: ``SermonNoteRow`` has
**no text field**, so the backup's ``scripture_text`` (copyrighted ESV/NKJV) is never carried into
a row (CLAUDE.md invariant 5). The book map is derived from Concord's ``canonical_order`` — never
hand-typed (invariant 4 lives or dies on this map). All I/O (reading the backup, fetching Concord,
writing the DB) lives in the CLI loader; this module is pure and unit-tested.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

_URL_RE = re.compile(r"https?://\S+")


def normalize_tags(names: Sequence[str]) -> list[str]:
    """Trim + lowercase + de-dupe (order-preserving) — the SAME normalization annotations use
    (mirrors ``songbird.api.annotations._normalize_tags``), so the seed reuses the existing tag
    vocabulary rather than creating a parallel one."""
    return list(dict.fromkeys(n.strip().lower() for n in names if n.strip()))


# Known canonical_order → USFM anchors; the book map must agree or it's wrong (wrong map lands
# notes on the wrong book silently).
_MAP_TRIPWIRE = {1: "GEN", 44: "ACT", 66: "REV"}


class SeedError(Exception):
    """A fatal problem in the seed source/transform — abort before writing any row."""


@dataclass(frozen=True)
class SermonNoteRow:
    """One ``sermon_notes`` row to insert. NO Scripture text by design."""

    title: str
    sermon_url: str
    reference: str  # the entry's scripture_ref verbatim — the full true span
    book_usfm: str
    book_order_index: int
    start_chapter: int
    start_verse: int
    end_chapter: int
    end_verse: int
    event_date: date | None
    tags: list[str] = field(default_factory=list)


def build_book_map(books: Sequence[Mapping[str, Any]]) -> dict[int, str]:
    """Concord ``/v1/books`` → ``{canonical_order: usfm_id}``. Raises if the known anchors disagree
    (a sanity tripwire that a swapped/garbled book list can't slip past)."""
    book_map: dict[int, str] = {int(b["canonical_order"]): str(b["id"]) for b in books}
    for order, usfm in _MAP_TRIPWIRE.items():
        if book_map.get(order) != usfm:
            raise SeedError(
                f"book-map tripwire failed: canonical_order {order} -> {book_map.get(order)!r}, "
                f"expected {usfm!r}. Refusing to seed against a suspect book map."
            )
    return book_map


def missing_book_indices(
    entries: Sequence[Mapping[str, Any]], book_map: Mapping[int, str]
) -> list[int]:
    """Every distinct ``book_order_index`` across ALL verses that the map can't resolve. The loader
    aborts (listing these) before writing a single row — never anchor a note to an unknown book."""
    seen: set[int] = set()
    for entry in entries:
        verses: Sequence[Mapping[str, Any]] = entry.get("verses") or []
        for verse in verses:
            seen.add(int(verse["book_order_index"]))
    return sorted(i for i in seen if i not in book_map)


def count_urls(observation: str | None) -> int:
    """How many ``http(s)`` URLs the observation text contains (for the loader's bad-URL report)."""
    return len(_URL_RE.findall(observation or ""))


def extract_url(observation: str | None) -> str:
    """The sermon URL is embedded in ``observation`` (often ``"<title>\\n<url>"``). Require exactly
    one ``http(s)`` URL; 0 or >1 is a data problem the loader surfaces rather than guessing."""
    urls = _URL_RE.findall(observation or "")
    if len(urls) != 1:
        raise SeedError(f"expected exactly 1 URL in observation, found {len(urls)}")
    return urls[0]


def parse_event_date(value: str | None) -> date | None:
    """Parse ``YYYY-MM-DD`` to a ``date``; return ``None`` for missing/unparseable (never crash)."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def split_runs(verses: Sequence[Mapping[str, Any]]) -> list[list[tuple[int, int, int]]]:
    """Split canonical ``verses[]`` into maximal runs of consecutive verses WITHIN A SINGLE
    CHAPTER. A run breaks at a verse gap, any chapter change, or any book change — so every run is
    single-book, single-chapter (needs no Concord verse-counts and cannot over-mark)."""
    tuples = sorted(
        (int(v["book_order_index"]), int(v["chapter"]), int(v["verse"])) for v in verses
    )
    runs: list[list[tuple[int, int, int]]] = []
    for t in tuples:
        if runs:
            pb, pc, pv = runs[-1][-1]
            if t[0] == pb and t[1] == pc and t[2] == pv + 1:
                runs[-1].append(t)
                continue
        runs.append([t])
    return runs


def transform_entry(entry: Mapping[str, Any], book_map: Mapping[int, str]) -> list[SermonNoteRow]:
    """One source entry → one ``SermonNoteRow`` per per-chapter run. All rows share the entry's
    title / sermon_url / event_date / tags, and the verbatim ``scripture_ref`` as ``reference``
    (so the popover shows the full true span even when an entry is split or multi-book)."""
    title = str(entry.get("title") or "").strip()
    sermon_url = extract_url(entry.get("observation"))
    reference = str(entry.get("scripture_ref") or "").strip()
    event_date = parse_event_date(entry.get("entry_date"))
    tags = normalize_tags(list(entry.get("tags") or []))

    rows: list[SermonNoteRow] = []
    for run in split_runs(entry.get("verses") or []):
        book_order_index = run[0][0]
        usfm = book_map.get(book_order_index)
        if usfm is None:
            raise SeedError(f"unmapped book_order_index {book_order_index} in {reference!r}")
        rows.append(
            SermonNoteRow(
                title=title,
                sermon_url=sermon_url,
                reference=reference,
                book_usfm=usfm,
                book_order_index=book_order_index,
                start_chapter=run[0][1],
                start_verse=run[0][2],
                end_chapter=run[-1][1],
                end_verse=run[-1][2],
                event_date=event_date,
                tags=tags,
            )
        )
    return rows


def find_true_duplicate_entries(
    entries: Sequence[Mapping[str, Any]],
) -> list[tuple[str, str]]:
    """Likely double-imports: (title, extracted-url) pairs that appear more than once. Reported for
    a human eyeball — NEVER auto-deleted (same passage by different preachers is legitimately
    distinct, and the chooser handles verse overlap)."""
    counts: dict[tuple[str, str], int] = {}
    for entry in entries:
        try:
            url = extract_url(entry.get("observation"))
        except SeedError:
            url = ""
        key = (str(entry.get("title") or "").strip(), url)
        counts[key] = counts.get(key, 0) + 1
    return [k for k, c in counts.items() if c > 1]
