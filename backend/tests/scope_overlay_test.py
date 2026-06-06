"""Decision B at the data level: out-of-scope-for-the-current-translation annotations are
returned with `in_scope=false` (shown-but-marked), never dropped."""

from collections.abc import Callable

import httpx
from tests.conftest import FakeConcordClient
from tests.helpers import DEFAULT_TRANSLATIONS, build_chapter

ANCHOR = {
    "book_usfm": "JHN",
    "start_chapter": 3,
    "start_verse": 16,
    "end_chapter": 3,
    "end_verse": 16,
    "note_markdown": "note",
}


def _fake(translation: str) -> FakeConcordClient:
    return FakeConcordClient(
        chapter=build_chapter("JHN", 3, translation, 20), translations=DEFAULT_TRANSLATIONS
    )


def _verse16(read_json: dict[str, object]) -> dict[str, object]:
    verses = read_json["verses"]
    assert isinstance(verses, list)
    return next(v for v in verses if v["verse"] == 16)


async def test_current_scope_in_scope_only_for_its_translation(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_fake("KJV")) as client:
        created = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "current", "translations": ["KJV"]},
        )
        annotation_id = created.json()["id"]
        kjv = _verse16((await client.get("/api/v1/read/KJV/JHN/3")).json())
    async with client_for(_fake("WEB")) as client:
        web = _verse16((await client.get("/api/v1/read/WEB/JHN/3")).json())

    # Present in BOTH (decision B: not hidden)...
    assert [a["id"] for a in kjv["annotations"]] == [annotation_id]
    assert [a["id"] for a in web["annotations"]] == [annotation_id]
    # ...but in scope only for KJV.
    assert kjv["annotations"][0]["in_scope"] is True
    assert web["annotations"][0]["in_scope"] is False
    assert web["annotations"][0]["scope_translations"] == ["KJV"]


async def test_all_scope_in_scope_everywhere(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_fake("KJV")) as client:
        await client.post("/api/v1/annotations", json={**ANCHOR, "scope_type": "all"})
        kjv = _verse16((await client.get("/api/v1/read/KJV/JHN/3")).json())
    async with client_for(_fake("WEB")) as client:
        web = _verse16((await client.get("/api/v1/read/WEB/JHN/3")).json())
    assert kjv["annotations"][0]["in_scope"] is True
    assert web["annotations"][0]["in_scope"] is True


async def test_subset_scope_in_scope_for_members_only(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_fake("KJV")) as client:
        await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "subset", "translations": ["KJV", "WEB"]},
        )
        kjv = _verse16((await client.get("/api/v1/read/KJV/JHN/3")).json())
    async with client_for(_fake("WEB")) as client:
        web = _verse16((await client.get("/api/v1/read/WEB/JHN/3")).json())
    async with client_for(_fake("ASV")) as client:
        asv = _verse16((await client.get("/api/v1/read/ASV/JHN/3")).json())
    assert kjv["annotations"][0]["in_scope"] is True
    assert web["annotations"][0]["in_scope"] is True
    assert asv["annotations"][0]["in_scope"] is False
