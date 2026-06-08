"""Study-notes keyword search proxy (v1.3 Slice 2). A thin, best-effort proxy of Concord's
`/v1/notes/search` over its translator's/study notes — the Search page's "Study notes" section,
distinct from "Scripture" and the user's own "Your notes". Any failure is swallowed to [] so the
section simply doesn't render and never degrades the rest of the page."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import NoteSearchHit, NoteSearchResponse
from tests.conftest import FakeConcordClient


def _hits() -> NoteSearchResponse:
    return NoteSearchResponse(
        hits=[
            NoteSearchHit(
                book="JHN",
                chapter=3,
                verse=16,
                reference="John 3:16",
                translation="NET",
                type="sn",
                snippet="The Greek word for <mark>love</mark> here is ἀγάπη.",
            ),
        ]
    )


async def test_study_notes_search_returns_shaped_hits(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(note_search=_hits())) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert resp.status_code == 200
    rows = resp.json()
    assert rows == [
        {
            "book": "JHN",
            "chapter": 3,
            "verse": 16,
            "reference": "John 3:16",
            "translation": "NET",
            "type": "sn",
            "snippet": "The Greek word for <mark>love</mark> here is ἀγάπη.",
        }
    ]


async def test_study_notes_search_empty_when_concord_has_none(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The stock Concord image ships zero notes → a normal empty result (section won't render).
    async with client_for(make_concord(note_search=NoteSearchResponse(hits=[]))) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_study_notes_search_empty_query_makes_no_call(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "   "})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_study_notes_search_swallows_client_error_to_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Best-effort: a client error (e.g. FTS5-unrunnable query) is swallowed to [] — no 4xx, no
    # section. This diverges from Scripture search on purpose (see the endpoint docstring).
    async with client_for(
        make_concord(error=ConcordNotFoundError("could not run that notes search: 400"))
    ) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "God's love"})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_study_notes_search_swallows_unreachable_to_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Best-effort again: even an outage is swallowed to [] here, so the Study-notes section never
    # degrades the page. The Scripture section remains the page's Concord-health signal (still 502).
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert resp.status_code == 200
    assert resp.json() == []
