"""The topics proxy: Concord's curated topical index, surfaced back the reader. songbird stores
no topic data — it passes Concord's topics (reverse lookup) and a topic's verses through
verbatim. A verse/topic with none is an empty 200; a bad/unknown ref or topic id is a not-found
(404), not unreachability (502). Synthetic fixtures only — never real topical data."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    TopicDetail,
    TopicSummary,
    TopicsResponse,
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


# --- topics browse (Slice 2: the gazetteer list + detail) --------------------------------------


def _topics_page() -> TopicsResponse:
    return TopicsResponse(
        q="lov",
        section="God",
        limit=10,
        offset=20,
        total=42,
        topics=[
            TopicSummary(id="love", name="Love", section="God", see_also=None),
            TopicSummary(id="charity", name="Charity", section="Virtues", see_also="love"),
        ],
    )


async def test_browse_topics_pass_through_and_filters(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(topics_page=_topics_page())
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/topics?q=lov&section=God&limit=10&offset=20")
    assert resp.status_code == 200
    body = resp.json()
    # The page-out is {topics, total} — mirrors PlacesPageOut, no limit/offset echoed.
    assert set(body.keys()) == {"topics", "total"}
    assert body["total"] == 42
    assert [t["id"] for t in body["topics"]] == ["love", "charity"]
    assert body["topics"][1]["see_also"] == "love"
    # The q / section / limit / offset all reached Concord (passthrough).
    assert fake.last_list_topics == {"q": "lov", "section": "God", "limit": 10, "offset": 20}


async def test_browse_topics_defaults(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # No filters → empty defaults (limit 50, offset 0), an empty page is a normal 200.
    fake = make_concord()
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/topics")
    assert resp.status_code == 200
    assert resp.json() == {"topics": [], "total": 0}
    assert fake.last_list_topics == {"q": None, "section": None, "limit": 50, "offset": 0}


async def test_browse_topics_bad_filter_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("bad section"))) as client:
        resp = await client.get("/api/v1/topics?section=Nope")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_browse_topics_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/topics")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_topic_detail_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    detail = TopicDetail(
        id="charity", name="Charity", section="Virtues", see_also="love", verse_count=0
    )
    async with client_for(make_concord(topic_detail=detail)) as client:
        resp = await client.get("/api/v1/topics/charity")
    assert resp.status_code == 200
    assert resp.json() == {
        "id": "charity",
        "name": "Charity",
        "section": "Virtues",
        "see_also": "love",
        "verse_count": 0,
    }


async def test_topic_detail_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown topic"))) as client:
        resp = await client.get("/api/v1/topics/nope")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_topic_detail_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/topics/love")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
