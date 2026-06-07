"""Sermon notes: songbird-owned, canonical-anchored, ALWAYS visible on every translation (no
scope), overlaid on the chapter like annotations. Full CRUD — the anchor is canonical coords
(invariant 4) and `book_order_index` is resolved server-side from Concord (never client-asserted).
Synthetic fixtures only; never the real backup."""

from collections.abc import Callable
from datetime import UTC, date, datetime

import httpx
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import Book
from songbird.db.models import SermonNote, Tag, User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tests.conftest import FakeConcordClient
from tests.helpers import DEFAULT_TRANSLATIONS, build_chapter

# Canonical book map the fake Concord serves for server-side book_order_index resolution.
_BOOKS = [
    Book(id="GEN", name="Genesis", testament="OT", chapter_count=50, canonical_order=1),
    Book(id="JHN", name="John", testament="NT", chapter_count=21, canonical_order=43),
    Book(id="ACT", name="Acts", testament="NT", chapter_count=28, canonical_order=44),
    Book(id="REV", name="Revelation", testament="NT", chapter_count=22, canonical_order=66),
]


def _fake(translation: str = "KJV") -> FakeConcordClient:
    return FakeConcordClient(
        chapter=build_chapter("JHN", 3, translation, 20),
        translations=DEFAULT_TRANSLATIONS,
        books=_BOOKS,
    )


async def _seed_note(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    book_usfm: str = "JHN",
    book_order_index: int = 43,
    start_chapter: int = 3,
    start_verse: int = 16,
    end_chapter: int = 3,
    end_verse: int = 16,
    reference: str = "John 3:16",
    title: str = "A sermon",
    sermon_url: str = "https://example.test/sermon",
    event_date: date | None = None,
    tags: list[str] | None = None,
    author_id: int = 1,
) -> int:
    async with sessionmaker() as session:
        note = SermonNote(
            title=title,
            sermon_url=sermon_url,
            reference=reference,
            book_usfm=book_usfm,
            book_order_index=book_order_index,
            start_chapter=start_chapter,
            start_verse=start_verse,
            end_chapter=end_chapter,
            end_verse=end_verse,
            event_date=event_date,
            author_id=author_id,
            tags=[Tag(name=t) for t in (tags or [])],
        )
        session.add(note)
        await session.commit()
        return note.id


def _verse(read_json: dict[str, object], verse: int) -> dict[str, object]:
    verses = read_json["verses"]
    assert isinstance(verses, list)
    return next(v for v in verses if v["verse"] == verse)


async def test_overlay_attaches_to_every_covered_verse(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A multi-verse note (JHN 3:14-17) rides every covered verse, and only those.
    note_id = await _seed_note(
        db_sessionmaker, start_verse=14, end_verse=17, reference="John 3:14-17"
    )
    async with client_for(_fake("KJV")) as client:
        body = (await client.get("/api/v1/read/KJV/JHN/3")).json()

    for v in (14, 15, 16, 17):
        ids = [s["id"] for s in _verse(body, v)["sermon_notes"]]
        assert ids == [note_id], f"verse {v} should carry the sermon note"
    for v in (13, 18):
        assert _verse(body, v)["sermon_notes"] == [], f"verse {v} should NOT carry it"


async def test_visible_on_every_translation_and_persists_across_switch(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # No scope concept: the same note shows in translation A AND B (the reader re-reads per
    # translation, so switching never clears it).
    note_id = await _seed_note(db_sessionmaker)
    async with client_for(_fake("KJV")) as client:
        kjv = _verse((await client.get("/api/v1/read/KJV/JHN/3")).json(), 16)
    async with client_for(_fake("WEB")) as client:
        web = _verse((await client.get("/api/v1/read/WEB/JHN/3")).json(), 16)

    assert [s["id"] for s in kjv["sermon_notes"]] == [note_id]
    assert [s["id"] for s in web["sermon_notes"]] == [note_id]
    # No in_scope field — sermon notes are unconditionally visible.
    assert "in_scope" not in kjv["sermon_notes"][0]


async def test_list_is_in_canonical_book_order(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Seed out of canonical order (Revelation before Genesis); the list returns canonical order.
    await _seed_note(
        db_sessionmaker, book_usfm="REV", book_order_index=66, reference="Revelation 1:1"
    )
    await _seed_note(
        db_sessionmaker, book_usfm="GEN", book_order_index=1, reference="Genesis 1:1"
    )
    async with client_for(_fake()) as client:
        rows = (await client.get("/api/v1/sermon-notes")).json()
    assert [r["book_usfm"] for r in rows] == ["GEN", "REV"]


async def test_serialization_tags_date_reference(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    note_id = await _seed_note(
        db_sessionmaker,
        title="Devoted to the Apostles' Teaching",
        sermon_url="https://youtu.be/abc123",
        reference="Acts 2:42-47",
        event_date=date(2026, 1, 5),
        tags=["acts", "church"],
    )
    async with client_for(_fake()) as client:
        note = (await client.get(f"/api/v1/sermon-notes/{note_id}")).json()

    assert note["title"] == "Devoted to the Apostles' Teaching"
    assert note["sermon_url"] == "https://youtu.be/abc123"
    assert note["reference"] == "Acts 2:42-47"
    assert note["event_date"] == "2026-01-05"
    assert sorted(note["tags"]) == ["acts", "church"]


async def test_null_event_date_serializes_null(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    note_id = await _seed_note(db_sessionmaker, event_date=None)
    async with client_for(_fake()) as client:
        note = (await client.get(f"/api/v1/sermon-notes/{note_id}")).json()
    assert note["event_date"] is None


async def test_get_unknown_404(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_fake()) as client:
        resp = await client.get("/api/v1/sermon-notes/999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "SERMON_NOTE_NOT_FOUND"


async def test_author_scoped_out_of_overlay_and_list(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A note owned by another author is invisible to user 1 (overlay, list, and by-id).
    async with db_sessionmaker() as session:
        session.add(User(id=2, name="someone-else", created_at=datetime.now(UTC)))
        await session.commit()
    other_id = await _seed_note(db_sessionmaker, author_id=2)

    async with client_for(_fake("KJV")) as client:
        read = (await client.get("/api/v1/read/KJV/JHN/3")).json()
        listed = (await client.get("/api/v1/sermon-notes")).json()
        by_id = await client.get(f"/api/v1/sermon-notes/{other_id}")

    assert _verse(read, 16)["sermon_notes"] == []
    assert listed == []
    assert by_id.status_code == 404


# --- Create / update / delete (Slice 15) ---

_CREATE_BODY = {
    "title": "A new sermon",
    "sermon_url": "https://example.test/new",
    "reference": "John 3:16",
    "book_usfm": "JHN",
    "start_chapter": 3,
    "start_verse": 16,
    "end_chapter": 3,
    "end_verse": 16,
}


async def test_create_persists_resolves_order_and_overlays(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # POST creates a row; the server resolves book_order_index from Concord (client never sends
    # it); the note then overlays the chapter by canonical coords (invariant 4).
    async with client_for(_fake("KJV")) as client:
        created = await client.post(
            "/api/v1/sermon-notes", json={**_CREATE_BODY, "tags": ["Grace"]}
        )
        assert created.status_code == 201
        body = created.json()
        assert body["book_order_index"] == 43  # resolved from Concord, not from the request
        assert body["book_usfm"] == "JHN"
        assert body["tags"] == ["grace"]  # normalized

        read = (await client.get("/api/v1/read/KJV/JHN/3")).json()
    assert [s["id"] for s in _verse(read, 16)["sermon_notes"]] == [body["id"]]


async def test_create_reuses_existing_tag_vocabulary(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # An existing annotation tag is reused, not duplicated — one shared vocabulary.
    async with db_sessionmaker() as session:
        session.add(Tag(name="grace"))
        await session.commit()
    async with client_for(_fake()) as client:
        resp = await client.post(
            "/api/v1/sermon-notes", json={**_CREATE_BODY, "tags": ["Grace", "grace"]}
        )
    assert resp.status_code == 201
    assert resp.json()["tags"] == ["grace"]
    async with db_sessionmaker() as session:
        rows = (await session.execute(select(Tag).where(Tag.name == "grace"))).scalars().all()
    assert len(rows) == 1  # not duplicated


async def test_create_unknown_book_422(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_fake()) as client:
        resp = await client.post(
            "/api/v1/sermon-notes", json={**_CREATE_BODY, "book_usfm": "ZZZ"}
        )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "INVALID_BOOK"


async def test_create_concord_unreachable_502(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Concord is a hard dependency: if it can't be reached to resolve the book, error (invariant 3).
    fake = FakeConcordClient(
        error=ConcordUnreachableError("http://concord.test", httpx.ConnectError("down"))
    )
    async with client_for(fake) as client:
        resp = await client.post("/api/v1/sermon-notes", json=_CREATE_BODY)
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_patch_updates_only_given_fields(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    note_id = await _seed_note(db_sessionmaker, title="Old", tags=["a"])
    async with client_for(_fake()) as client:
        resp = await client.patch(
            f"/api/v1/sermon-notes/{note_id}", json={"title": "New", "tags": ["b", "c"]}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "New"
        assert sorted(body["tags"]) == ["b", "c"]
        # Untouched fields are preserved.
        assert body["sermon_url"] == "https://example.test/sermon"
        assert body["reference"] == "John 3:16"


async def test_patch_other_author_404(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with db_sessionmaker() as session:
        session.add(User(id=2, name="someone-else", created_at=datetime.now(UTC)))
        await session.commit()
    other_id = await _seed_note(db_sessionmaker, author_id=2)
    async with client_for(_fake()) as client:
        resp = await client.patch(f"/api/v1/sermon-notes/{other_id}", json={"title": "Hijack"})
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "SERMON_NOTE_NOT_FOUND"


async def test_delete_removes(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    note_id = await _seed_note(db_sessionmaker)
    async with client_for(_fake()) as client:
        resp = await client.delete(f"/api/v1/sermon-notes/{note_id}")
        assert resp.status_code == 204
        gone = await client.get(f"/api/v1/sermon-notes/{note_id}")
    assert gone.status_code == 404


async def test_delete_other_author_404(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with db_sessionmaker() as session:
        session.add(User(id=2, name="someone-else", created_at=datetime.now(UTC)))
        await session.commit()
    other_id = await _seed_note(db_sessionmaker, author_id=2)
    async with client_for(_fake()) as client:
        resp = await client.delete(f"/api/v1/sermon-notes/{other_id}")
    assert resp.status_code == 404
    # The other author's note still exists.
    async with db_sessionmaker() as session:
        assert await session.get(SermonNote, other_id) is not None
