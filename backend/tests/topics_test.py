"""The topics proxy: Concord's curated topical index, surfaced back the reader. songbird stores
no topic data — it passes Concord's topics (reverse lookup) and a topic's verses through
verbatim. A verse/topic with none is an empty 200; a bad/unknown ref or topic id is a not-found
(404), not unreachability (502). Synthetic fixtures only — never real topical data."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    TopicSummary,
    TopicVerse,
    TopicVersesResponse,
    VerseTopicsResponse,
)
from tests.conftest import FakeConcordClient


def _verse_topics() -> VerseTopicsResponse:
    return VerseTopicsResponse(
        reference="John 3:16",
        total=2,
        topics=[
            TopicSummary(id="love", name="Love", section="God", see_also=None),
            # A "See X" redirect row — carries no verses of its own. Won't normally appear in a
            # reverse lookup, but the schema allows it, so exercise the passthrough defensively.
            TopicSummary(id="charity", name="Charity", section="Virtues", see_also="love"),
        ],
    )


def _topic_verses(translation: str | None = "WEB") -> TopicVersesResponse:
    return TopicVersesResponse(
        id="love",
        translation=translation,
        include_text=True,
        limit=50,
        offset=0,
        total=2,
        verses=[
            TopicVerse(
                book="JHN", chapter=3, verse=16, reference="John 3:16", text="For God so loved…"
            ),
            TopicVerse(
                book="ROM", chapter=5, verse=8, reference="Romans 5:8", text="But God commends…"
            ),
        ],
    )


# --- verse-topics (the reverse lookup) ---------------------------------------------------------


async def test_verse_topics_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(verse_topics=_verse_topics())) as client:
        resp = await client.get("/api/v1/verse-topics/JHN/3/16")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2

    assert rows[0] == {"id": "love", "name": "Love", "section": "God", "see_also": None}
    # A see_also redirect row passes through verbatim (the target topic id).
    assert rows[1]["id"] == "charity"
    assert rows[1]["see_also"] == "love"


async def test_verse_topics_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A verse with no curated topics → 200 empty, not an error.
    empty = VerseTopicsResponse(reference="PHM 1:1", total=0, topics=[])
    async with client_for(make_concord(verse_topics=empty)) as client:
        resp = await client.get("/api/v1/verse-topics/PHM/1/1")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_verse_topics_default_empty_when_unset(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord()) as client:
        resp = await client.get("/api/v1/verse-topics/JHN/3/16")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_verse_topics_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("bad ref"))) as client:
        resp = await client.get("/api/v1/verse-topics/XXX/1/1")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_verse_topics_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/verse-topics/JHN/3/16")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


# --- topic-verses (a topic's verses) -----------------------------------------------------------


async def test_topic_verses_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(topic_verses=_topic_verses())) as client:
        resp = await client.get("/api/v1/topics/love/verses?translation=WEB")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2
    assert rows[0] == {
        "book": "JHN",
        "chapter": 3,
        "verse": 16,
        "reference": "John 3:16",
        "text": "For God so loved…",
    }
    assert rows[1]["book"] == "ROM" and rows[1]["verse"] == 8


async def test_topic_verses_translation_optional(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # No translation query param — the verses still pass through (text may then be null upstream).
    async with client_for(make_concord(topic_verses=_topic_verses(translation=None))) as client:
        resp = await client.get("/api/v1/topics/love/verses")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_topic_verses_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown topic"))) as client:
        resp = await client.get("/api/v1/topics/nope/verses")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_topic_verses_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/topics/love/verses")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
