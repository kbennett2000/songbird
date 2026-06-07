"""Import / export of notes & sermon notes (issue #41). Hermetic — the fake Concord serves the
translation + book lists that import validates against. Synthetic fixtures only."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import Book
from tests.conftest import FakeConcordClient
from tests.helpers import DEFAULT_TRANSLATIONS

_BOOKS = [
    Book(id="GEN", name="Genesis", testament="OT", chapter_count=50, canonical_order=1),
    Book(id="JHN", name="John", testament="NT", chapter_count=21, canonical_order=43),
    Book(id="ACT", name="Acts", testament="NT", chapter_count=28, canonical_order=44),
]


def _fake() -> FakeConcordClient:
    return FakeConcordClient(translations=DEFAULT_TRANSLATIONS, books=_BOOKS)


def _document() -> dict[str, object]:
    """A portable export document with varied scope + tags, for round-trip + idempotency tests."""
    return {
        "version": 1,
        "annotations": [
            {
                "book_usfm": "JHN",
                "start_chapter": 3,
                "start_verse": 16,
                "end_chapter": 3,
                "end_verse": 16,
                "note_markdown": "**For God so loved**",
                "color": None,
                "scope_type": "all",
                "scope_translations": [],
                "tags": ["grace", "faith"],
            },
            {
                "book_usfm": "JHN",
                "start_chapter": 1,
                "start_verse": 1,
                "end_chapter": 1,
                "end_verse": 1,
                "note_markdown": "In the beginning was the Word",
                "color": "amber",
                "scope_type": "subset",
                "scope_translations": ["KJV", "WEB"],
                "tags": [],
            },
        ],
        "sermon_notes": [
            {
                "title": "The New Birth",
                "sermon_url": "https://example.test/sermon",
                "reference": "John 3:16",
                "book_usfm": "JHN",
                "start_chapter": 3,
                "start_verse": 16,
                "end_chapter": 3,
                "end_verse": 16,
                "event_date": "2026-01-05",
                "tags": ["faith"],
            }
        ],
    }


def _norm_ann(a: dict[str, object]) -> dict[str, object]:
    """Strip volatile fields and order-normalize the unordered ones for comparison."""
    return {
        **{
            k: a[k]
            for k in (
                "book_usfm",
                "start_chapter",
                "start_verse",
                "end_chapter",
                "end_verse",
                "note_markdown",
                "color",
                "scope_type",
            )
        },
        "scope_translations": sorted(a["scope_translations"]),  # type: ignore[arg-type]
        "tags": sorted(a["tags"]),  # type: ignore[arg-type]
    }


def _norm_sermon(s: dict[str, object]) -> dict[str, object]:
    return {
        **{
            k: s[k]
            for k in (
                "title",
                "sermon_url",
                "reference",
                "book_usfm",
                "start_chapter",
                "start_verse",
                "end_chapter",
                "end_verse",
                "event_date",
            )
        },
        "tags": sorted(s["tags"]),  # type: ignore[arg-type]
    }


async def test_import_then_export_round_trip(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    doc = _document()
    async with client_for(_fake()) as client:
        imported = await client.post("/api/v1/import", json=doc)
        assert imported.status_code == 200
        summary = imported.json()
        assert summary["annotations"] == {"created": 2, "skipped": 0, "failed": 0}
        assert summary["sermon_notes"] == {"created": 1, "skipped": 0, "failed": 0}

        exported = await client.get("/api/v1/export")
    assert exported.status_code == 200
    body = exported.json()

    # The document survives a full round-trip (import → export), modulo ordering and unordered
    # tags/codes (export sorts by canonical anchor; tags/scope codes are sets).
    def _ann_sort(a: dict[str, object]) -> tuple[object, ...]:
        return (a["book_usfm"], a["start_chapter"], a["start_verse"])

    assert sorted((_norm_ann(a) for a in body["annotations"]), key=_ann_sort) == sorted(
        (_norm_ann(a) for a in doc["annotations"]),
        key=_ann_sort,  # type: ignore[union-attr]
    )
    assert [_norm_sermon(s) for s in body["sermon_notes"]] == [
        _norm_sermon(s)
        for s in doc["sermon_notes"]  # type: ignore[union-attr]
    ]
    # Export is account-agnostic — no ids/author leak into the portable file.
    assert all("id" not in a and "author_id" not in a for a in body["annotations"])
    assert all("id" not in s and "author_id" not in s for s in body["sermon_notes"])


async def test_sermon_note_book_order_index_resolved_on_import(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_fake()) as client:
        await client.post("/api/v1/import", json=_document())
        notes = (await client.get("/api/v1/sermon-notes")).json()
    # JHN's canonical_order from Concord (_BOOKS), never asserted by the import file.
    assert [n["book_order_index"] for n in notes] == [43]


async def test_import_is_idempotent(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    doc = _document()
    async with client_for(_fake()) as client:
        await client.post("/api/v1/import", json=doc)
        second = (await client.post("/api/v1/import", json=doc)).json()
        # Nothing new on the re-import — every item is an exact duplicate.
        assert second["annotations"] == {"created": 0, "skipped": 2, "failed": 0}
        assert second["sermon_notes"] == {"created": 0, "skipped": 1, "failed": 0}

        anns = (await client.get("/api/v1/annotations")).json()
        notes = (await client.get("/api/v1/sermon-notes")).json()
    assert len(anns) == 2  # not 4 — no duplicates created
    assert len(notes) == 1


async def test_import_rejects_unknown_book_and_translation(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    doc: dict[str, object] = {
        "annotations": [
            {  # unknown scope translation — rejected
                "book_usfm": "JHN",
                "start_chapter": 3,
                "start_verse": 16,
                "end_chapter": 3,
                "end_verse": 16,
                "note_markdown": "scoped to a missing translation",
                "scope_type": "subset",
                "scope_translations": ["XYZ"],
                "tags": [],
            },
            {  # valid — still imported
                "book_usfm": "JHN",
                "start_chapter": 1,
                "start_verse": 1,
                "end_chapter": 1,
                "end_verse": 1,
                "note_markdown": "valid one",
                "scope_type": "all",
                "scope_translations": [],
                "tags": [],
            },
        ],
        "sermon_notes": [
            {  # unknown book — rejected
                "title": "Bad book",
                "sermon_url": "https://example.test/x",
                "reference": "Zzz 1:1",
                "book_usfm": "ZZZ",
                "start_chapter": 1,
                "start_verse": 1,
                "end_chapter": 1,
                "end_verse": 1,
                "event_date": None,
                "tags": [],
            }
        ],
    }
    async with client_for(_fake()) as client:
        summary = (await client.post("/api/v1/import", json=doc)).json()
        anns = (await client.get("/api/v1/annotations")).json()
    assert summary["annotations"] == {"created": 1, "skipped": 0, "failed": 1}
    assert summary["sermon_notes"] == {"created": 0, "skipped": 0, "failed": 1}
    assert len(summary["errors"]) == 2
    assert len(anns) == 1  # the valid annotation landed; the bad one didn't


async def test_import_concord_unreachable_is_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    concord = make_concord(translations=DEFAULT_TRANSLATIONS, books=_BOOKS, error=err)
    async with client_for(concord) as client:
        resp = await client.post("/api/v1/import", json=_document())
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_export_and_import_require_auth(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with unauth_client(_fake()) as client:
        assert (await client.get("/api/v1/export")).status_code == 401
        assert (await client.post("/api/v1/import", json=_document())).status_code == 401
