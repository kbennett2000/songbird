"""Tags attach/detach on annotations — songbird's own domain, get-or-create + reuse."""

from collections.abc import Callable

import httpx
from songbird.db.models import SermonNote, Tag
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
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


async def test_tag_orphaned_by_replacement_is_hidden(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Replacing an annotation's tags leaves the old Tag row with no associations — #94: it
    # must not surface in the tag list.
    async with client_for(make_concord()) as client:
        created = await client.post("/api/v1/annotations", json={**ANCHOR, "tags": ["temp"]})
        annotation_id = created.json()["id"]
        await client.patch(f"/api/v1/annotations/{annotation_id}", json={"tags": ["kept"]})
        tags = (await client.get("/api/v1/tags")).json()
    assert tags == ["kept"]


async def test_tag_orphaned_by_deletion_is_hidden(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Deleting the only annotation using a tag orphans it — #94: it must not surface.
    async with client_for(make_concord()) as client:
        created = await client.post("/api/v1/annotations", json={**ANCHOR, "tags": ["gone"]})
        annotation_id = created.json()["id"]
        await client.delete(f"/api/v1/annotations/{annotation_id}")
        tags = (await client.get("/api/v1/tags")).json()
    assert tags == []


async def test_sermon_note_tags_appear(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    # The list unions both association tables — a tag used only by a sermon note still appears.
    async with db_sessionmaker() as session:
        session.add(
            SermonNote(
                title="A sermon",
                sermon_url="https://example.test/sermon",
                reference="John 3:16",
                book_usfm="JHN",
                book_order_index=43,
                start_chapter=3,
                start_verse=16,
                end_chapter=3,
                end_verse=16,
                author_id=1,
                tags=[Tag(name="homily")],
            )
        )
        await session.commit()
    async with client_for(make_concord()) as client:
        tags = (await client.get("/api/v1/tags")).json()
    assert tags == ["homily"]
