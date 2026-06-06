"""The tag/browse core is Concord-free: it works even when Concord is unreachable. (Scripture
concerns → Concord; annotation concerns → songbird. Tags are entirely songbird's.)"""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordUnreachableError
from tests.conftest import FakeConcordClient

ANCHOR = {
    "book_usfm": "JHN",
    "start_chapter": 3,
    "start_verse": 16,
    "end_chapter": 3,
    "end_verse": 16,
    "note_markdown": "note",
}


def _down() -> FakeConcordClient:
    # Any call to this client raises — so a green result proves no Concord call was made.
    return FakeConcordClient(
        error=ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    )


async def test_create_all_scope_tagged_annotation_without_concord(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_down()) as client:
        resp = await client.post("/api/v1/annotations", json={**ANCHOR, "tags": ["grace"]})
    # 'all'-scope + tags makes no Concord call.
    assert resp.status_code == 201
    assert resp.json()["tags"] == ["grace"]


async def test_browse_and_tags_list_without_concord(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_down()) as client:
        await client.post("/api/v1/annotations", json={**ANCHOR, "tags": ["grace"]})
        browse = await client.get("/api/v1/annotations", params={"tags": "grace"})
        tags = await client.get("/api/v1/tags")
    assert browse.status_code == 200 and len(browse.json()) == 1
    assert tags.status_code == 200 and tags.json() == ["grace"]
