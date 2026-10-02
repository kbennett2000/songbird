"""Study-notes keyword search proxy (v1.3 Slice 2; paged and filterable by Bible in v1.8). A thin
proxy of Concord's `/v1/notes/search` over its translator's/study notes — the Search page's "Study
notes" section, distinct from "Scripture" and the user's own "Your notes". One page at a time with
the total across pages; a query Concord can't run is an empty page, and an outage is a 502."""

from collections.abc import Callable

import httpx
import pytest
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import NoteSearchHit, NoteSearchResponse
from tests.conftest import FakeConcordClient


def _hit(translation: str = "NET", verse: int = 16) -> NoteSearchHit:
    return NoteSearchHit(
        book="JHN",
        chapter=3,
        verse=verse,
        reference=f"John 3:{verse}",
        translation=translation,
        type="sn",
        snippet="The Greek word for <mark>love</mark> here is ἀγάπη.",
    )


async def test_study_notes_search_returns_a_shaped_page(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    page = NoteSearchResponse(hits=[_hit()], total=42)
    async with client_for(make_concord(note_search=page)) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert resp.status_code == 200
    assert resp.json() == {
        "results": [
            {
                "book": "JHN",
                "chapter": 3,
                "verse": 16,
                "reference": "John 3:16",
                "translation": "NET",
                "type": "sn",
                "snippet": "The Greek word for <mark>love</mark> here is ἀγάπη.",
                # Concord v8's fields — absent from an older Concord's hit, so they arrive as null.
                "label": None,
                "text_format": None,
            }
        ],
        # The total across every page, so the page knows there's more to load.
        "total": 42,
    }


async def test_study_notes_search_asks_for_the_first_page_of_all_bibles_by_default(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(note_search=NoteSearchResponse(hits=[], total=0))
    async with client_for(fake) as client:
        await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert fake.last_note_search == {"q": "love", "translation": None, "limit": 20, "offset": 0}


async def test_study_notes_search_passes_the_page_and_the_bible_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(note_search=NoteSearchResponse(hits=[_hit("EMB")], total=118))
    async with client_for(fake) as client:
        resp = await client.get(
            "/api/v1/study-notes-search",
            params={"q": "love", "translation": "emb", "limit": "20", "offset": "40"},
        )
    assert resp.status_code == 200
    # Codes are upper-cased, as everywhere else songbird names a Bible.
    assert fake.last_note_search == {"q": "love", "translation": "EMB", "limit": 20, "offset": 40}
    assert resp.json()["total"] == 118


async def test_study_notes_search_without_a_total_treats_the_page_as_the_last(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A Concord that doesn't send `total`: no "Load more", rather than a guess.
    page = NoteSearchResponse(hits=[_hit(verse=16), _hit(verse=17)])
    async with client_for(make_concord(note_search=page)) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love", "offset": "20"})
    assert resp.json()["total"] == 22


async def test_study_notes_search_empty_when_concord_has_none(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The stock Concord image ships zero notes → a normal empty page.
    page = NoteSearchResponse(hits=[], total=0)
    async with client_for(make_concord(note_search=page)) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert resp.status_code == 200
    assert resp.json() == {"results": [], "total": 0}


async def test_study_notes_search_empty_query_makes_no_call(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    fake = make_concord(error=err)
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "   "})
    assert resp.status_code == 200
    assert resp.json() == {"results": [], "total": 0}
    assert fake.last_note_search is None


async def test_study_notes_search_a_query_concord_cannot_run_is_an_empty_page(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Concord's FTS5 400s on punctuation, and a Bible it doesn't hold is a 404: neither is an
    # outage, so the page shows "no matches", as keyword search does (issue #51).
    async with client_for(
        make_concord(error=ConcordNotFoundError("could not run that notes search: 400"))
    ) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "God's love"})
    assert resp.status_code == 200
    assert resp.json() == {"results": [], "total": 0}


async def test_study_notes_search_an_outage_is_a_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Invariant 3: the section shows an empty state now, so an outage swallowed to [] would read as
    # "nothing matches". It's an error the page names instead.
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love"})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


@pytest.mark.parametrize(
    "params",
    [
        {"limit": "0"},
        {"limit": "101"},
        {"offset": "-1"},
        {"translation": ""},
        {"translation": "NOT A CODE"},
        {"translation": "X" * 17},
    ],
)
async def test_study_notes_search_rejects_a_bad_page_or_bible(
    params: dict[str, str],
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(note_search=NoteSearchResponse(hits=[], total=0))
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "love", **params})
    assert resp.status_code == 422
    assert fake.last_note_search is None
