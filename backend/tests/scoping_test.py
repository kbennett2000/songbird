"""Author scoping: one user never sees another's annotations — not in browse, not in the read
overlay; cross-user GET/PATCH/DELETE is a 404 (no existence leak). Real auth via `unauth_client`,
two cookie jars over one shared in-memory DB."""

from collections.abc import Callable

import httpx
from tests.conftest import FakeConcordClient
from tests.helpers import ANNOTATION_BODY, build_chapter

USER_A = {"username": "alice", "password": "passwordA"}
USER_B = {"username": "bob", "password": "passwordB"}


async def test_annotations_are_scoped_to_author(
    make_concord: type[FakeConcordClient],
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    def concord_factory() -> FakeConcordClient:
        return make_concord(chapter=build_chapter("JHN", 3, "KJV", verses=20))

    # User A registers (claims default id=1) and writes a note on JHN 3:16.
    async with unauth_client(concord_factory()) as a:
        await a.post("/api/v1/auth/register", json=USER_A)
        created = await a.post("/api/v1/annotations", json=ANNOTATION_BODY)
        assert created.status_code == 201
        a_annotation_id = created.json()["id"]

        a_browse = await a.get("/api/v1/annotations")
        assert [x["id"] for x in a_browse.json()] == [a_annotation_id]

    # User B registers (new user) — sees none of A's notes.
    async with unauth_client(concord_factory()) as b:
        await b.post("/api/v1/auth/register", json=USER_B)

        # Browse: empty.
        b_browse = await b.get("/api/v1/annotations")
        assert b_browse.status_code == 200
        assert b_browse.json() == []

        # Read overlay: verse 16 has no annotation for B.
        read = await b.get("/api/v1/read/KJV/JHN/3")
        assert read.status_code == 200
        by_verse = {v["verse"]: v for v in read.json()["verses"]}
        assert by_verse[16]["annotations"] == []

        # Direct access to A's annotation → 404 (not 403 — no existence leak).
        assert (await b.get(f"/api/v1/annotations/{a_annotation_id}")).status_code == 404
        patch = await b.patch(
            f"/api/v1/annotations/{a_annotation_id}", json={"note_markdown": "hijack"}
        )
        assert patch.status_code == 404
        assert (await b.delete(f"/api/v1/annotations/{a_annotation_id}")).status_code == 404

    # A still sees their note intact (B's failed PATCH didn't touch it).
    async with unauth_client(concord_factory()) as a:
        await a.post("/api/v1/auth/login", json=USER_A)
        fetched = await a.get(f"/api/v1/annotations/{a_annotation_id}")
        assert fetched.status_code == 200
        assert fetched.json()["note_markdown"] == ANNOTATION_BODY["note_markdown"]
