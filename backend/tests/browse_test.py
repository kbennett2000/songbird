"""Browse annotations with a tag filter, and the tags-list endpoint."""

from collections.abc import Callable

import httpx
from tests.conftest import FakeConcordClient

BASE = {
    "book_usfm": "JHN",
    "start_chapter": 3,
    "end_chapter": 3,
    "note_markdown": "note",
}


async def _seed(client: httpx.AsyncClient) -> None:
    # v16 tagged {grace, faith}; v17 tagged {grace}; v18 untagged.
    await client.post(
        "/api/v1/annotations",
        json={**BASE, "start_verse": 16, "end_verse": 16, "tags": ["grace", "faith"]},
    )
    await client.post(
        "/api/v1/annotations", json={**BASE, "start_verse": 17, "end_verse": 17, "tags": ["grace"]}
    )
    await client.post(
        "/api/v1/annotations", json={**BASE, "start_verse": 18, "end_verse": 18, "tags": []}
    )


def _verses(rows: list[dict[str, object]]) -> list[int]:
    return sorted(r["start_verse"] for r in rows)


async def test_browse_no_filter_lists_all(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await _seed(client)
        rows = (await client.get("/api/v1/annotations")).json()
    assert _verses(rows) == [16, 17, 18]


async def test_browse_single_tag(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await _seed(client)
        rows = (await client.get("/api/v1/annotations", params={"tags": "grace"})).json()
    assert _verses(rows) == [16, 17]


async def test_browse_multiple_tags_AND(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await _seed(client)
        rows = (await client.get("/api/v1/annotations", params={"tags": "grace,faith"})).json()
    # Only v16 has BOTH.
    assert _verses(rows) == [16]


async def test_browse_multiple_tags_any(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await _seed(client)
        rows = (
            await client.get("/api/v1/annotations", params={"tags": "faith,nope", "match": "any"})
        ).json()
    assert _verses(rows) == [16]


async def test_tags_list_sorted(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await _seed(client)
        tags = (await client.get("/api/v1/tags")).json()
    assert tags == ["faith", "grace"]
