"""The word-study proxy: Concord's tagged original-language tokens, Strong's lexicon, and
concordance, surfaced back the reader. songbird stores none of this — it passes Concord's tokens
(with text_id), lexicon entries, and concordance verses through verbatim. A bad ref/id is a
not-found (404), not unreachability (502); a valid verse with no tagged original is a normal empty
200 (NOT a 404). Synthetic fixtures only — never real text/lexicon data."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    StrongsDetail,
    StrongsVerse,
    StrongsVersesResponse,
    VerseWordsResponse,
    WordTokenOut,
)
from tests.conftest import FakeConcordClient


def _verse_words() -> VerseWordsResponse:
    return VerseWordsResponse(
        reference="John 1:1",
        text_id="SBLGNT",
        total=2,
        tokens=[
            # A tagged token (drillable) …
            WordTokenOut(
                position=1,
                surface_form="λόγος",
                strongs_id="G3056",
                morph_code="N-NSM",
                lemma="λόγος",
                transliteration="logos",
                gloss="word",
            ),
            # … and an untagged one (punctuation/particle) — nulls pass through verbatim.
            WordTokenOut(
                position=2,
                surface_form=".",
                strongs_id=None,
                morph_code=None,
                lemma=None,
                transliteration=None,
                gloss=None,
            ),
        ],
    )


def _strongs() -> StrongsDetail:
    return StrongsDetail(
        strongs_id="G3056",
        language="greek",
        lemma="λόγος",
        transliteration="logos",
        gloss="word",
        definition="a word, speech, account, reason…",
        source="Strong's Greek",
    )


def _strongs_verses(translation: str | None = "WEB") -> StrongsVersesResponse:
    return StrongsVersesResponse(
        strongs_id="G3056",
        text_id="SBLGNT",
        translation=translation,
        include_text=True,
        limit=50,
        offset=0,
        total=2,
        verses=[
            StrongsVerse(
                book="JHN", chapter=1, verse=1, reference="John 1:1", text="In the beginning…"
            ),
            StrongsVerse(
                book="JHN", chapter=1, verse=14, reference="John 1:14", text="And the Word…"
            ),
        ],
    )


# --- verse-words (the interlinear strip) -------------------------------------------------------


async def test_verse_words_pass_through_with_text_id(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(verse_words=_verse_words())) as client:
        resp = await client.get("/api/v1/verse-words/JHN/1/1")
    assert resp.status_code == 200
    body = resp.json()
    # NOT a bare list — the wrapper carries reference + text_id (so the client can pick RTL).
    assert body["reference"] == "John 1:1"
    assert body["text_id"] == "SBLGNT"
    tokens = body["tokens"]
    assert len(tokens) == 2
    # A tagged token …
    assert tokens[0]["strongs_id"] == "G3056"
    assert tokens[0]["lemma"] == "λόγος" and tokens[0]["gloss"] == "word"
    # … and an untagged token whose lexical fields are null (passed through verbatim).
    assert tokens[1]["strongs_id"] is None
    assert tokens[1]["lemma"] is None


async def test_verse_words_empty_is_200_not_found(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A VALID ref with no tagged original (e.g. deuterocanon) → 200 with tokens: [], still carrying
    # text_id — NOT a 404.
    empty = VerseWordsResponse(reference="TOB 1:1", text_id="LXX", total=0, tokens=[])
    async with client_for(make_concord(verse_words=empty)) as client:
        resp = await client.get("/api/v1/verse-words/TOB/1/1")
    assert resp.status_code == 200
    assert resp.json() == {"reference": "TOB 1:1", "text_id": "LXX", "tokens": []}


async def test_verse_words_default_empty_when_unset(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        resp = await client.get("/api/v1/verse-words/JHN/1/1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tokens"] == []
    assert body["text_id"]  # a text_id is always present, even when empty


async def test_verse_words_bad_ref_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("bad ref"))) as client:
        resp = await client.get("/api/v1/verse-words/XXX/1/1")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_verse_words_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/verse-words/JHN/1/1")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


# --- strongs detail (the lexical payoff) -------------------------------------------------------


async def test_strongs_detail_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(strongs=_strongs())) as client:
        resp = await client.get("/api/v1/strongs/G3056")
    assert resp.status_code == 200
    assert resp.json() == {
        "strongs_id": "G3056",
        "language": "greek",
        "lemma": "λόγος",
        "transliteration": "logos",
        "gloss": "word",
        "definition": "a word, speech, account, reason…",
        "source": "Strong's Greek",
    }


async def test_strongs_detail_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown id"))) as client:
        resp = await client.get("/api/v1/strongs/G9999999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_strongs_detail_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/strongs/G3056")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


# --- strongs concordance (a bare list) ---------------------------------------------------------


async def test_strongs_verses_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(strongs_verses=_strongs_verses())) as client:
        resp = await client.get("/api/v1/strongs/G3056/verses?translation=WEB")
    assert resp.status_code == 200
    rows = resp.json()
    # A bare list (no text_id wrapper — the concordance is LTR English).
    assert isinstance(rows, list)
    assert len(rows) == 2
    assert rows[0] == {
        "book": "JHN",
        "chapter": 1,
        "verse": 1,
        "reference": "John 1:1",
        "text": "In the beginning…",
    }
    assert rows[1]["verse"] == 14


async def test_strongs_verses_translation_optional(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(strongs_verses=_strongs_verses(translation=None))) as client:
        resp = await client.get("/api/v1/strongs/G3056/verses")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_strongs_verses_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown id"))) as client:
        resp = await client.get("/api/v1/strongs/G9999999/verses")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_strongs_verses_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/strongs/G3056/verses")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
