"""Live smoke test against a real Concord. Marked `concord`; excluded from the default run.

Run with: `pytest -m concord` (Concord must be reachable at CONCORD_BASE_URL).

The v1.8 checks hold for the pinned image, which carries no study Bible (no notes, documents or
pictures, and Nave's as its only topical index), and for a Concord that has one.
"""

import os

import pytest
from songbird.concord.client import ConcordClient, ConcordNotFoundError

pytestmark = pytest.mark.concord


async def test_live_translations() -> None:
    base_url = os.environ.get("CONCORD_BASE_URL", "http://localhost:8000")
    client = ConcordClient(base_url)
    try:
        translations = await client.list_translations()
    finally:
        await client.aclose()
    assert len(translations) >= 1


async def test_live_health() -> None:
    base_url = os.environ.get("CONCORD_BASE_URL", "http://localhost:8000")
    client = ConcordClient(base_url)
    try:
        health = await client.health()
    finally:
        await client.aclose()
    assert health.status == "ok"
    assert health.translation_count >= 1


async def test_live_keyword_search() -> None:
    # Pins the real shape of Concord's untyped `/v1/search` response (issue #46): a common word
    # must return canonical-coordinate matches the client can parse.
    base_url = os.environ.get("CONCORD_BASE_URL", "http://localhost:8000")
    client = ConcordClient(base_url)
    try:
        result = await client.keyword_search("God", limit=5)
    finally:
        await client.aclose()
    assert len(result.hits) >= 1
    first = result.hits[0]
    assert first.book and first.chapter >= 1 and first.verse >= 1
    assert first.snippet  # Concord returns the verse text as a (highlight-marked) snippet


def _client() -> ConcordClient:
    return ConcordClient(os.environ.get("CONCORD_BASE_URL", "http://localhost:8000"))


async def test_live_translations_carry_v8_counts() -> None:
    # songbird offers a Bible's notes and documents by these counts (v1.8 slices A and C).
    client = _client()
    try:
        translations = await client.list_translations()
    finally:
        await client.aclose()
    for t in translations:
        assert isinstance(t.note_count, int) and t.note_count >= 0, t.id
        assert isinstance(t.document_count, int) and t.document_count >= 0, t.id


async def test_live_topics_carry_their_source() -> None:
    # Topics by source (v1.8 slice D): each topic names its index, the browse lists the indexes,
    # and `?source=` keeps to one.
    client = _client()
    try:
        page = await client.list_topics(limit=5)
        assert page.sources, "Concord listed no topical index"
        assert all(t.source for t in page.topics)
        first = page.sources[0]
        one = await client.list_topics(limit=5, source=first.source)
        with pytest.raises(ConcordNotFoundError):
            await client.list_topics(source="A made-up index")
    finally:
        await client.aclose()
    assert one.source == first.source
    assert one.total == first.total
    assert all(t.source == first.source for t in one.topics)


async def test_live_documents_and_pictures() -> None:
    # A Bible's documents (v1.8 slices C1 and C2) parse, and an unknown document or picture is a
    # not-found rather than unreachability.
    client = _client()
    try:
        translation = (await client.list_translations())[0].id
        listed = await client.list_documents(translation)
        with pytest.raises(ConcordNotFoundError):
            await client.get_document(translation, "made-up-document")
        with pytest.raises(ConcordNotFoundError):
            await client.get_asset(translation, "made-up-picture.jpg")
    finally:
        await client.aclose()
    assert listed.translation == translation
    assert listed.total == len(listed.documents)
