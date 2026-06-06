"""Tags attach/detach on annotations — songbird's own domain, get-or-create + reuse."""

from collections.abc import Callable

import httpx
from tests.conftest import FakeConcordClient

ANCHOR = {
    "book_usfm": "JHN",
    "start_chapter": 3,
    "start_verse": 16,
    "end_chapter": 3,
    "end_verse": 16,
    "note_markdown": "note",
}


async def test_create_with_tags(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        resp = await client.post(
            "/api/v1/annotations", json={**ANCHOR, "tags": ["Grace", "  faith ", "grace"]}
        )
    assert resp.status_code == 201
    # normalized (trim + lower) and de-duplicated.
    assert resp.json()["tags"] == ["grace", "faith"]


async def test_update_replaces_tags(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        created = await client.post("/api/v1/annotations", json={**ANCHOR, "tags": ["a", "b"]})
        annotation_id = created.json()["id"]
        patched = await client.patch(f"/api/v1/annotations/{annotation_id}", json={"tags": ["c"]})
    assert patched.status_code == 200
    assert patched.json()["tags"] == ["c"]


async def test_tags_are_reused_across_annotations(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        await client.post("/api/v1/annotations", json={**ANCHOR, "tags": ["shared"]})
        await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "start_verse": 17, "end_verse": 17, "tags": ["shared"]},
        )
        tags = (await client.get("/api/v1/tags")).json()
    # One row for "shared", despite two annotations using it.
    assert tags == ["shared"]
