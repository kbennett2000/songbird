"""Concord v8's note fields (ADR-0011) reach the client — and an older Concord still works.

Concord v8 appends `label`, `title`, `text_format` and `passages` to every note and notes-search
hit, and `note_count` to every translation. songbird validates Concord's JSON into its own models
and re-maps notes field by field, so each new field has to be carried at both layers or it's
silently dropped. A Concord that predates v8 (the pinned v1.2.0 image) sends none of them, and
songbird must answer exactly as before, with the new keys null or empty.

Made-up note text only — never a real study Bible's notes.
"""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordClient
from songbird.concord.schemas import (
    NotePassage,
    NoteSearchHit,
    NoteSearchResponse,
    NotesResponse,
    Translation,
    TranslatorNote,
)
from tests.conftest import FakeConcordClient

# A note as an older Concord sends it: no v8 keys at all.
_OLD_NOTE: dict[str, object] = {
    "book": "GEN",
    "chapter": 12,
    "verse": 10,
    "reference": "Genesis 12:10",
    "type": "tn",
    "text": "A made-up plain note.",
    "char_offset": 4,
    "marker": "a",
    "ordinal": 0,
    "cross_references": [],
}

# The same note as Concord v8 sends it for a study Bible: every new key set.
_V8_NOTE: dict[str, object] = {
    **_OLD_NOTE,
    "type": "sn",
    "text": "A *made-up* study note. See [the next chapter](ref:GEN.13).",
    "char_offset": 0,
    "label": "Study Note",
    "title": "A made-up heading",
    "text_format": "markdown",
    "passages": [
        {
            "start_chapter": 12,
            "start_verse": 10,
            "end_chapter": 13,
            "end_verse": 4,
            "reference": "Genesis 12:10-13:4",
        }
    ],
    "image": None,
}


def _notes_json(note: dict[str, object]) -> dict[str, object]:
    return {
        "translation": "EMB",
        "book": "GEN",
        "chapter": 12,
        "verse": None,
        "total": 1,
        "notes": [note],
    }


def _concord(body: dict[str, object]) -> ConcordClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))


# --- The wire: songbird's Concord models parse both shapes ---


async def test_client_parses_a_note_from_an_older_concord() -> None:
    client = _concord(_notes_json(_OLD_NOTE))
    note = (await client.get_notes("NET", "GEN", 12)).notes[0]
    await client.aclose()
    assert (note.label, note.title, note.text_format, note.passages) == (None, None, None, [])


async def test_client_parses_a_v8_note() -> None:
    client = _concord(_notes_json(_V8_NOTE))
    note = (await client.get_notes("EMB", "GEN", 12)).notes[0]
    await client.aclose()
    assert note.label == "Study Note"
    assert note.title == "A made-up heading"
    assert note.text_format == "markdown"
    assert note.passages[0].reference == "Genesis 12:10-13:4"
    assert (note.passages[0].end_chapter, note.passages[0].end_verse) == (13, 4)


async def test_client_parses_note_count_and_its_absence() -> None:
    entry = {"name": "x", "language": "en", "versification": "standard", "attribution": None}
    client = _concord(
        {"translations": [{**entry, "id": "EMB", "note_count": 7}, {**entry, "id": "KJV"}]}
    )
    translations = await client.list_translations()
    await client.aclose()
    assert [(t.id, t.note_count) for t in translations] == [("EMB", 7), ("KJV", None)]


# --- songbird's API: the fields reach the browser ---


def _note(**v8: object) -> TranslatorNote:
    return TranslatorNote.model_validate({**_OLD_NOTE, **v8})


async def test_notes_route_passes_the_v8_fields_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    note = TranslatorNote.model_validate(_V8_NOTE)
    concord = make_concord(
        notes=NotesResponse(translation="EMB", book="GEN", chapter=12, total=1, notes=[note])
    )
    async with client_for(concord) as client:
        resp = await client.get("/api/v1/notes/EMB/GEN/12")
    assert resp.status_code == 200
    row = resp.json()[0]
    assert row["label"] == "Study Note"
    assert row["title"] == "A made-up heading"
    assert row["text_format"] == "markdown"
    assert row["text"] == _V8_NOTE["text"]  # Markdown passes through untouched
    assert row["passages"] == [
        {
            "start_chapter": 12,
            "start_verse": 10,
            "end_chapter": 13,
            "end_verse": 4,
            "reference": "Genesis 12:10-13:4",
        }
    ]


async def test_notes_route_answers_as_before_for_an_older_concord(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(
        notes=NotesResponse(translation="NET", book="GEN", chapter=12, total=1, notes=[_note()])
    )
    async with client_for(concord) as client:
        resp = await client.get("/api/v1/notes/NET/GEN/12")
    row = resp.json()[0]
    # Every field an older songbird sent is unchanged …
    assert {k: row[k] for k in _OLD_NOTE} == _OLD_NOTE
    # … and the new ones are empty.
    assert (row["label"], row["title"], row["text_format"], row["passages"]) == (
        None,
        None,
        None,
        [],
    )


async def test_study_notes_search_passes_label_and_format(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    hit = NoteSearchHit(
        book="GEN",
        chapter=12,
        verse=10,
        reference="Genesis 12:10",
        translation="EMB",
        type="sn",
        snippet="A *made-up* <mark>study</mark> note.",
        label="Study Note",
        text_format="markdown",
    )
    async with client_for(make_concord(note_search=NoteSearchResponse(hits=[hit]))) as client:
        resp = await client.get("/api/v1/study-notes-search", params={"q": "study"})
    row = resp.json()[0]
    assert (row["label"], row["text_format"]) == ("Study Note", "markdown")
    assert row["snippet"] == "A *made-up* <mark>study</mark> note."  # stripping is the client's


async def test_translations_route_passes_note_count_and_null_when_absent(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    def tr(id_: str, note_count: int | None) -> Translation:
        return Translation(
            id=id_, name=id_, language="en", versification="standard", note_count=note_count
        )

    concord = make_concord(translations=[tr("EMB", 7), tr("KJV", 0), tr("OLD", None)])
    async with client_for(concord) as client:
        resp = await client.get("/api/v1/translations")
    counts = {t["id"]: t["note_count"] for t in resp.json()["translations"]}
    assert counts == {"EMB": 7, "KJV": 0, "OLD": None}


def test_passage_model_matches_concords_shape() -> None:
    # The API model and the Concord model carry the same keys, so nothing is renamed in transit.
    from songbird.api.schemas import NotePassage as ApiPassage

    assert set(ApiPassage.model_fields) == set(NotePassage.model_fields)
