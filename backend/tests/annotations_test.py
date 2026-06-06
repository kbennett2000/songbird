from collections.abc import Callable

import httpx
from tests.conftest import FakeConcordClient
from tests.helpers import ANNOTATION_BODY


async def test_annotation_crud_round_trip(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        # Create
        created = await client.post("/api/v1/annotations", json=ANNOTATION_BODY)
        assert created.status_code == 201
        body = created.json()
        annotation_id = body["id"]
        assert body["book_usfm"] == "JHN"
        assert body["start_verse"] == 16 and body["end_verse"] == 16
        assert body["note_markdown"] == ANNOTATION_BODY["note_markdown"]  # Markdown verbatim
        assert body["scope_type"] == "all"
        assert body["author_id"] == 1

        # Read
        fetched = await client.get(f"/api/v1/annotations/{annotation_id}")
        assert fetched.status_code == 200
        assert fetched.json()["note_markdown"] == ANNOTATION_BODY["note_markdown"]

        # Update
        patched = await client.patch(
            f"/api/v1/annotations/{annotation_id}",
            json={"note_markdown": "# Revised\n\nNew body.", "color": "amber"},
        )
        assert patched.status_code == 200
        assert patched.json()["note_markdown"] == "# Revised\n\nNew body."
        assert patched.json()["color"] == "amber"

        # Delete
        deleted = await client.delete(f"/api/v1/annotations/{annotation_id}")
        assert deleted.status_code == 204
        gone = await client.get(f"/api/v1/annotations/{annotation_id}")
        assert gone.status_code == 404
        assert gone.json()["detail"]["code"] == "ANNOTATION_NOT_FOUND"


async def test_get_missing_annotation_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        resp = await client.get("/api/v1/annotations/999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "ANNOTATION_NOT_FOUND"
