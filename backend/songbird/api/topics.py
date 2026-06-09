"""Topical Bible — Concord's curated topical index (a ~5,300-topic Nave's-style index). songbird
owns no topic data; these routes pass Concord's topics through verbatim. Two reverse-lookup
reads back the reader: a verse's topics, and a topic's verses. Same proxy shape as
cross-references — a bad/unknown ref or topic id is a not-found (404), not unreachability (502)."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import TopicDetail, TopicsPageOut, TopicSummary, TopicVerse
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["topics"])


@router.get("/verse-topics/{book}/{chapter}/{verse}", response_model=list[TopicSummary])
async def verse_topics(
    book: str,
    chapter: int,
    verse: int,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[TopicSummary]:
    """The topics a verse appears under (Concord's reverse lookup). songbird owns none of this —
    pure pass-through. The client builds the canonical "{book} {chapter}:{verse}" ref."""
    try:
        result = await concord.get_verse_topics(book, chapter, verse)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        TopicSummary(id=t.id, name=t.name, section=t.section, see_also=t.see_also)
        for t in result.topics
    ]


@router.get("/topics/{topic_id}/verses", response_model=list[TopicVerse])
async def topic_verses(
    topic_id: str,
    translation: str | None = None,
    limit: int = 50,
    offset: int = 0,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[TopicVerse]:
    """The verses curated under a topic (with text). Canonical coords, so the reader jumps to
    them directly. Pure pass-through of Concord's topic data."""
    try:
        result = await concord.get_topic_verses(topic_id, translation, limit, offset)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        TopicVerse(
            book=v.book,
            chapter=v.chapter,
            verse=v.verse,
            reference=v.reference,
            text=v.text,
        )
        for v in result.verses
    ]


# --- Browse (Slice 2): the topics gazetteer. `/topics` (list) and `/topics/{id}` (detail) coexist
# with `/topics/{id}/verses` above — distinct segment counts, so no route shadows another. Errors
# SURFACE here (404/502): browse is a screen's primary content, not a best-effort sidecar.


@router.get("/topics", response_model=TopicsPageOut)
async def browse_topics(
    q: str | None = None,
    section: str | None = None,
    limit: int = 50,
    offset: int = 0,
    concord: ConcordClient = Depends(get_concord_client),
) -> TopicsPageOut:
    """Browse the whole topical index with optional name (`q`) / section filters, paginated.
    A bad filter → 404; unreachable → 502."""
    try:
        page = await concord.list_topics(q=q, section=section, limit=limit, offset=offset)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    topics = [
        TopicSummary(id=t.id, name=t.name, section=t.section, see_also=t.see_also)
        for t in page.topics
    ]
    return TopicsPageOut(topics=topics, total=page.total)


@router.get("/topics/{topic_id}", response_model=TopicDetail)
async def topic_detail(
    topic_id: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> TopicDetail:
    """One topic's full record (incl. `see_also` + `verse_count`). A 404 is a real not-found."""
    try:
        detail = await concord.get_topic(topic_id)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return TopicDetail(
        id=detail.id,
        name=detail.name,
        section=detail.section,
        see_also=detail.see_also,
        verse_count=detail.verse_count,
    )
