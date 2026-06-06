"""Keyword search over the user's notes — songbird's own domain, Concord-free. The honest
stand-in for semantic note search (which awaits a Concord embed-arbitrary-text endpoint)."""

from collections.abc import Callable

import httpx
from tests.conftest import FakeConcordClient

BASE = {"book_usfm": "JHN", "start_chapter": 3, "end_chapter": 3}


async def test_note_keyword_search(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await client.post(
            "/api/v1/annotations",
            json={
                **BASE,
                "start_verse": 16,
                "end_verse": 16,
                "note_markdown": "On **anxiety** and peace",
            },
        )
        await client.post(
            "/api/v1/annotations",
            json={
                **BASE,
                "start_verse": 17,
                "end_verse": 17,
                "note_markdown": "A note about grace",
            },
        )
        # Case-insensitive substring over note_markdown.
        hits = (await client.get("/api/v1/annotations", params={"q": "ANXIETY"})).json()
        miss = (await client.get("/api/v1/annotations", params={"q": "nothingmatches"})).json()

    assert [a["start_verse"] for a in hits] == [16]
    assert miss == []


async def test_note_keyword_search_is_concord_free(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The note search must not touch Concord (a raising fake still returns results).
    from songbird.concord.client import ConcordUnreachableError

    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    async with client_for(make_concord(error=err)) as client:
        await client.post(
            "/api/v1/annotations",
            json={**BASE, "start_verse": 16, "end_verse": 16, "note_markdown": "anxious thoughts"},
        )
        resp = await client.get("/api/v1/annotations", params={"q": "anxious"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1
