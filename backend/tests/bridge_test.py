"""The canonical-coordinate bridge (CLAUDE.md invariant 4, SPEC §4) — the test this slice
exists to make pass.

An annotation is anchored to an *address* (JHN 3:16), not to a translation's rendering. So a
note created while reading one translation must overlay the correct verse when the chapter is
fetched in a *different* translation. This is what keeps songbird from inheriting
soap-journal's per-translation-id limitation.
"""

import os
from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI
from songbird.api.deps import get_concord_client, get_db
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient
from tests.helpers import ANNOTATION_BODY, build_chapter


async def test_bridge_annotation_shows_across_translations(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Create the annotation on JHN 3:16 while "reading" KJV.
    kjv = make_concord(chapter=build_chapter("JHN", 3, "KJV", verses=20))
    async with client_for(kjv) as client:
        created = await client.post("/api/v1/annotations", json=ANNOTATION_BODY)
        assert created.status_code == 201
        annotation_id = created.json()["id"]

        kjv_read = (await client.get("/api/v1/read/KJV/JHN/3")).json()

    # Fetch the SAME chapter in a DIFFERENT translation (WEB) — same DB, new Concord text.
    web = make_concord(chapter=build_chapter("JHN", 3, "WEB", verses=20))
    async with client_for(web) as client:
        web_read = (await client.get("/api/v1/read/WEB/JHN/3")).json()

    kjv_by_verse = {v["verse"]: v for v in kjv_read["verses"]}
    web_by_verse = {v["verse"]: v for v in web_read["verses"]}

    # Same annotation, same verse address, in both translations.
    assert [a["id"] for a in kjv_by_verse[16]["annotations"]] == [annotation_id]
    assert [a["id"] for a in web_by_verse[16]["annotations"]] == [annotation_id]

    # ...and nowhere else.
    assert web_by_verse[15]["annotations"] == []
    assert web_by_verse[17]["annotations"] == []

    # The text differs (different rendering); the anchor does not (same address).
    assert kjv_by_verse[16]["text"] != web_by_verse[16]["text"]
    assert kjv_read["translation"] == "KJV"
    assert web_read["translation"] == "WEB"


@pytest.mark.concord
async def test_bridge_live_against_concord(
    app: FastAPI,
    db_sessionmaker: async_sessionmaker[AsyncSession],
) -> None:
    """The bridge, end-to-end against a real Concord: create an annotation, then overlay the
    real KJV and WEB renderings of John 3 and confirm it lands on verse 16 in both."""
    from songbird.concord.client import ConcordClient

    real = ConcordClient(os.environ.get("CONCORD_BASE_URL", "http://localhost:8000"))

    async def _db_override() -> object:
        async with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_concord_client] = lambda: real
    app.dependency_overrides[get_db] = _db_override
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            created = await client.post("/api/v1/annotations", json=ANNOTATION_BODY)
            assert created.status_code == 201
            annotation_id = created.json()["id"]

            kjv = (await client.get("/api/v1/read/KJV/JHN/3")).json()
            web = (await client.get("/api/v1/read/WEB/JHN/3")).json()
    finally:
        await real.aclose()

    kjv16 = next(v for v in kjv["verses"] if v["verse"] == 16)
    web16 = next(v for v in web["verses"] if v["verse"] == 16)
    assert [a["id"] for a in kjv16["annotations"]] == [annotation_id]
    assert [a["id"] for a in web16["annotations"]] == [annotation_id]
    assert kjv16["text"] != web16["text"]  # really two different translations
