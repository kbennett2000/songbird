"""The /resolve endpoint: songbird delegates reference parsing to Concord and returns canonical
coordinates, preserving the 404 (bad reference) vs 502 (unreachable) split."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import Chapter, ChapterVerse
from tests.conftest import FakeConcordClient


def _chapter_result() -> Chapter:
    """A multi-verse result — i.e. a chapter reference like 'John 3'."""
    return Chapter(
        reference="John 3",
        translations=["KJV"],
        verses=[
            ChapterVerse(
                book="JHN", chapter=3, verse=v, reference=f"John 3:{v}", text={"KJV": "..."}
            )
            for v in range(1, 37)
        ],
    )


def _single_verse_result() -> Chapter:
    """A single-verse result — i.e. a verse reference like 'Gen 1:1'."""
    return Chapter(
        reference="Genesis 1:1",
        translations=["KJV"],
        verses=[
            ChapterVerse(
                book="GEN", chapter=1, verse=1, reference="Genesis 1:1", text={"KJV": "..."}
            )
        ],
    )


async def test_resolve_chapter_reference_has_no_verse(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(chapter=_chapter_result())) as client:
        resp = await client.get("/api/v1/resolve", params={"ref": "John 3"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["book"] == "JHN"
    assert body["chapter"] == 3
    assert body["verse"] is None  # chapter ref → no single verse to highlight
    assert body["reference"] == "John 3"


async def test_resolve_single_verse_reference_keeps_verse(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(chapter=_single_verse_result())) as client:
        resp = await client.get("/api/v1/resolve", params={"ref": "Gen 1:1"})
    assert resp.status_code == 200
    body = resp.json()
    assert (body["book"], body["chapter"], body["verse"]) == ("GEN", 1, 1)


async def test_resolve_unparseable_is_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("nope"))) as client:
        resp = await client.get("/api/v1/resolve", params={"ref": "asdfqwer"})
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_resolve_unreachable_is_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/resolve", params={"ref": "John 3"})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
