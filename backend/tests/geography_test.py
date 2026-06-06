"""The geography proxy: places for a passage + a place's verses, from Concord. The crux is
that Concord's honesty model (status + confidence + nullable coordinates) is carried through
verbatim — an unknown place is shown unknown, never a fabricated pin."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    Place,
    PlaceVerse,
    PlaceVersesResponse,
    VersePlacesResponse,
)
from tests.conftest import FakeConcordClient


def _places() -> VersePlacesResponse:
    return VersePlacesResponse(
        places=[
            Place(
                id="a15257a",
                friendly_id="Jerusalem",
                name="Jerusalem",
                type="settlement",
                latitude=31.78,
                longitude=35.23,
                confidence="high",
                confidence_score=90,
                status="identified",
            ),
            Place(
                id="a1ad8e1",
                friendly_id="Nod",
                name="Land of Nod",
                type="region",
                latitude=None,
                longitude=None,
                confidence=None,
                confidence_score=None,
                status="unknown",
            ),
        ]
    )


async def test_places_carry_the_honesty_model(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(places=_places())) as client:
        resp = await client.get("/api/v1/places", params={"book": "GEN", "chapter": 4})
    assert resp.status_code == 200
    rows = {p["friendly_id"]: p for p in resp.json()}

    # Identified place → coordinates + confidence.
    assert rows["Jerusalem"]["status"] == "identified"
    assert rows["Jerusalem"]["latitude"] == 31.78
    assert rows["Jerusalem"]["confidence"] == "high"

    # Unknown place → null coordinates + null confidence, preserved (NOT defaulted to 0/"").
    nod = rows["Nod"]
    assert nod["status"] == "unknown"
    assert nod["latitude"] is None
    assert nod["longitude"] is None
    assert nod["confidence"] is None


async def test_places_empty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(places=VersePlacesResponse(places=[]))) as client:
        resp = await client.get("/api/v1/places", params={"book": "PHM", "chapter": 1})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_places_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("bad ref"))) as client:
        resp = await client.get("/api/v1/places", params={"book": "XXX", "chapter": 1})
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_places_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/places", params={"book": "GEN", "chapter": 2})
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_place_verses_canonical(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    pv = PlaceVersesResponse(
        verses=[PlaceVerse(book="GEN", chapter=2, verse=8, reference="Genesis 2:8")]
    )
    async with client_for(make_concord(place_verses=pv)) as client:
        resp = await client.get("/api/v1/places/af3daeb/verses")
    assert resp.status_code == 200
    assert resp.json()[0] == {"book": "GEN", "chapter": 2, "verse": 8, "reference": "Genesis 2:8"}


async def test_place_verses_unknown_place_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("no place"))) as client:
        resp = await client.get("/api/v1/places/does-not-exist/verses")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"
