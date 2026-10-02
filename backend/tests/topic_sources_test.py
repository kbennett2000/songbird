"""Topics by source (v1.8 slice D; Concord ADR-0013).

Concord now loads more than one topical index. Every topic carries its `source`, and the browse
lists every loaded index with its count (`sources`) and takes `?source=`. songbird passes them
through at request time and stores nothing; a Concord that predates them sends neither, and
songbird then answers exactly as before. Made-up topic and index names only: a study Bible's
topic names are its own text.
"""

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from songbird.concord.client import ConcordClient, ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    TopicDetail,
    TopicSourceCount,
    TopicsResponse,
    TopicSummary,
    VerseTopicsResponse,
)
from tests.conftest import FakeConcordClient

_FIRST = "First Made-up Index"
_SECOND = "Second Made-up Index"


def _topic(id_: str, name: str, source: str | None, see_also: str | None = None) -> TopicSummary:
    return TopicSummary(id=id_, name=name, section="M", see_also=see_also, source=source)


# --- the routes ---------------------------------------------------------------------------------


async def test_a_verses_topics_carry_their_source(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    topics = VerseTopicsResponse(
        reference="Made-up 1:2",
        total=2,
        topics=[_topic("made-up-a", "MADE-UP A", _FIRST), _topic("mx-1", "Made-up b", _SECOND)],
    )
    async with client_for(make_concord(verse_topics=topics)) as client:
        resp = await client.get("/api/v1/verse-topics/GEN/1/2")
    assert resp.status_code == 200
    assert [(t["id"], t["source"]) for t in resp.json()] == [
        ("made-up-a", _FIRST),
        ("mx-1", _SECOND),
    ]


async def test_the_browse_passes_sources_through_and_keeps_concords_order(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    page = TopicsResponse(
        q="made",
        section=None,
        limit=50,
        offset=0,
        total=3,
        # Concord's own order (binary by name): capitals first, whatever the source.
        topics=[
            _topic("made-up-a", "MADE-UP A", _FIRST),
            _topic("made-up-c", "MADE-UP C", _FIRST),
            _topic("mx-1", "Made-up b", _SECOND),
        ],
        source=None,
        sources=[
            TopicSourceCount(source=_FIRST, total=2),
            TopicSourceCount(source=_SECOND, total=1),
        ],
    )
    fake = make_concord(topics_page=page)
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/topics?q=made")
    assert resp.status_code == 200
    body = resp.json()
    assert [(t["id"], t["source"]) for t in body["topics"]] == [
        ("made-up-a", _FIRST),
        ("made-up-c", _FIRST),
        ("mx-1", _SECOND),
    ]
    assert body["sources"] == [{"source": _FIRST, "total": 2}, {"source": _SECOND, "total": 1}]
    assert fake.last_list_topics["source"] is None


async def test_the_browse_forwards_a_source_filter(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord()
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/topics", params={"source": _SECOND, "section": "M"})
    assert resp.status_code == 200
    assert fake.last_list_topics == {
        "q": None,
        "section": "M",
        "source": _SECOND,
        "limit": 50,
        "offset": 0,
    }


async def test_an_unknown_source_is_a_not_found(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    error = ConcordNotFoundError("Concord could not run that topics query: 400")
    async with client_for(make_concord(error=error)) as client:
        resp = await client.get("/api/v1/topics", params={"source": "No Such Index"})
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_a_topics_detail_carries_its_source(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    detail = TopicDetail(
        id="mx-2", name="Made-up d", section="M", see_also="mx-1", verse_count=0, source=_SECOND
    )
    async with client_for(make_concord(topic_detail=detail)) as client:
        resp = await client.get("/api/v1/topics/mx-2")
    assert resp.status_code == 200
    assert resp.json()["source"] == _SECOND
    assert resp.json()["see_also"] == "mx-1"


# --- the client ---------------------------------------------------------------------------------


def _concord(handler: Callable[[httpx.Request], httpx.Response]) -> ConcordClient:
    return ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))


def _page(**extra: Any) -> dict[str, Any]:
    return {
        "q": None,
        "section": None,
        "limit": 50,
        "offset": 0,
        "total": 1,
        "topics": [{"id": "made-up-a", "name": "MADE-UP A", "section": "M", "see_also": None}],
        **extra,
    }


async def test_the_client_sends_a_source_only_when_asked() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_page())

    client = _concord(handler)
    await client.list_topics(q="made")
    await client.list_topics(source=_FIRST, section="M")
    await client.aclose()
    # An older Concord never sees `source`: it isn't sent unless a filter was chosen.
    assert dict(seen[0].url.params) == {"limit": "50", "offset": "0", "q": "made"}
    assert dict(seen[1].url.params) == {
        "limit": "50",
        "offset": "0",
        "section": "M",
        "source": _FIRST,
    }


async def test_the_client_parses_sources_and_their_absence() -> None:
    newer = _page(
        source=_FIRST,
        sources=[{"source": _FIRST, "total": 1}, {"source": _SECOND, "total": 0}],
    )
    newer["topics"][0]["source"] = _FIRST
    bodies = [newer, _page()]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=bodies.pop(0))

    client = _concord(handler)
    with_sources = await client.list_topics(source=_FIRST)
    older = await client.list_topics()
    await client.aclose()
    assert with_sources.source == _FIRST
    assert [(s.source, s.total) for s in with_sources.sources] == [(_FIRST, 1), (_SECOND, 0)]
    assert with_sources.topics[0].source == _FIRST
    assert older.source is None and older.sources == [] and older.topics[0].source is None


async def test_the_client_parses_a_topics_source_and_its_absence() -> None:
    detail = {"id": "mx-2", "name": "Made-up d", "section": "M", "see_also": None, "verse_count": 3}
    bodies = [{**detail, "source": _SECOND}, detail]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=bodies.pop(0))

    client = _concord(handler)
    newer = await client.get_topic("mx-2")
    older = await client.get_topic("mx-2")
    await client.aclose()
    assert newer.source == _SECOND
    assert older.source is None


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (400, ConcordNotFoundError),  # an unknown source: `unknown_source`
        (500, ConcordUnreachableError),
    ],
)
async def test_the_client_maps_a_bad_source(status: int, error: type[Exception]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"code": "unknown_source"}})

    client = _concord(handler)
    with pytest.raises(error):
        await client.list_topics(source="No Such Index")
    await client.aclose()
