"""The headings proxy: a chapter's section headings (editorial passage titles), from Concord.
songbird stores no headings — it passes Concord's canonical anchors, before_verse, and ordinal
through verbatim. A translation with no headings is an empty 200, not an error (so the reader
just shows nothing, and no banner). Synthetic fixtures only — never real translation data."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import HeadingsResponse, SectionHeading
from tests.conftest import FakeConcordClient


def _headings() -> HeadingsResponse:
    return HeadingsResponse(
        translation="WEB",
        book="GEN",
        chapter=1,
        total=2,
        headings=[
            SectionHeading(
                book="GEN",
                chapter=1,
                before_verse=1,
                text="The Creation",
                ordinal=1,
                reference="Genesis 1:1",
            ),
            SectionHeading(
                book="GEN",
                chapter=1,
                before_verse=3,
                text="The First Day",
                ordinal=2,
                reference="Genesis 1:3",
            ),
        ],
    )


async def test_headings_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(headings=_headings())) as client:
        resp = await client.get("/api/v1/headings/WEB/GEN/1")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 2

    # Headings pass through verbatim, in ordinal order, with canonical anchors + before_verse.
    assert [h["text"] for h in rows] == ["The Creation", "The First Day"]
    assert [h["ordinal"] for h in rows] == [1, 2]
    first = rows[0]
    assert first["book"] == "GEN" and first["chapter"] == 1
    assert first["before_verse"] == 1
    assert first["reference"] == "Genesis 1:1"
    assert rows[1]["before_verse"] == 3


async def test_headings_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # A known translation with no headings (e.g. BSB) → 200 empty, not an error.
    empty = HeadingsResponse(translation="BSB", book="GEN", chapter=1, total=0, headings=[])
    async with client_for(make_concord(headings=empty)) as client:
        resp = await client.get("/api/v1/headings/BSB/GEN/1")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_headings_default_empty_when_unset(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # The fake's default (no headings configured) mirrors most translations: empty 200.
    async with client_for(make_concord()) as client:
        resp = await client.get("/api/v1/headings/KJV/PHM/1")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_headings_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown book"))) as client:
        resp = await client.get("/api/v1/headings/WEB/XXX/1")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_headings_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/headings/WEB/GEN/1")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
