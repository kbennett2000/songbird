"""The notes proxy: a passage's translator's notes (tn/sn/tc/map), from Concord. songbird
stores no notes — it passes Concord's canonical anchors, char_offset point anchors, and the
notes' own cross-references through verbatim. A translation with no notes is an empty 200, not
an error (so the reader just shows no markers). Synthetic fixtures only — never real NET data."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    NoteCrossReference,
    NotesResponse,
    TranslatorNote,
)
from tests.conftest import FakeConcordClient


def _notes() -> NotesResponse:
    return NotesResponse(
        translation="NET",
        book="JHN",
        chapter=3,
        verse=None,
        total=2,
        notes=[
            # Mirrors a real live NET John 3:16 note (ordinal is 0-based; marker "7"; the
            # char_offset anchors into the verse text). Its cross-refs include a RANGE
            # (to_verse_end set) and a single verse (to_verse_end null) — both live shapes.
            TranslatorNote(
                book="JHN",
                chapter=3,
                verse=16,
                reference="John 3:16",
                type="tn",
                text="Or 'this is how much'; or 'in this way.' The Greek adverb οὕτως…",
                char_offset=19,
                marker="7",
                ordinal=0,
                cross_references=[
                    NoteCrossReference(
                        to_book="JHN",
                        to_chapter=3,
                        to_verse_start=14,
                        to_verse_end=17,
                        reference="John 3:14-17",
                    ),
                    NoteCrossReference(
                        to_book="JHN",
                        to_chapter=3,
                        to_verse_start=16,
                        to_verse_end=None,
                        reference="John 3:16",
                    ),
                ],
            ),
            # Synthetic study note kept to exercise the nullable-marker + Unicode path the
            # live sample happens not to hit (every live John 3:16 note has a non-null marker).
            TranslatorNote(
                book="JHN",
                chapter=3,
                verse=16,
                reference="John 3:16",
                type="sn",
                text="A study note with Greek: ἀγάπη.",
                char_offset=65,
                marker=None,
                ordinal=1,
                cross_references=[],
            ),
        ],
    )


async def test_notes_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(notes=_notes())) as client:
        resp = await client.get("/api/v1/notes/NET/JHN/3")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2

    tn = rows[0]
    assert tn["book"] == "JHN" and tn["chapter"] == 3 and tn["verse"] == 16
    assert tn["type"] == "tn"
    assert tn["char_offset"] == 19
    assert tn["marker"] == "7"
    assert tn["ordinal"] == 0  # live ordinals are 0-based
    # A range cross-ref (to_verse_end set) passes through verbatim …
    assert tn["cross_references"][0] == {
        "to_book": "JHN",
        "to_chapter": 3,
        "to_verse_start": 14,
        "to_verse_end": 17,
        "reference": "John 3:14-17",
    }
    # … alongside a single-verse cross-ref (to_verse_end null).
    assert tn["cross_references"][1]["to_verse_end"] is None

    # Greek Unicode in the body survives the pass-through intact; null marker stays null.
    sn = rows[1]
    assert sn["type"] == "sn"
    assert "ἀγάπη" in sn["text"]
    assert sn["marker"] is None
    assert sn["cross_references"] == []


async def test_notes_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A known translation with no notes (e.g. KJV) → 200 empty, not an error.
    empty = NotesResponse(
        translation="KJV", book="JHN", chapter=3, verse=None, total=0, notes=[]
    )
    async with client_for(make_concord(notes=empty)) as client:
        resp = await client.get("/api/v1/notes/KJV/JHN/3")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_notes_default_empty_when_unset(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The fake's default (no notes configured) mirrors the public image: empty 200.
    async with client_for(make_concord()) as client:
        resp = await client.get("/api/v1/notes/NET/PHM/1")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_notes_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown book"))) as client:
        resp = await client.get("/api/v1/notes/NET/XXX/1")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_notes_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/notes/NET/JHN/3")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
