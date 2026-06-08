"""Places gazetteer (v1.4 Slice 3) — browse the whole place corpus + per-place detail, over
Concord's `/v1/places` and `/v1/places/{id}`. Distinct from the per-chapter map endpoint
(`/api/v1/places?book=&chapter=`), which is untouched. Errors surface here (this is a screen's
primary content) — NOT best-effort: unreachable → 502, a bad filter / unknown id → 404."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import Place, PlaceDetail, PlacesPage
from tests.conftest import FakeConcordClient


def _page() -> PlacesPage:
    return PlacesPage(
        total=1340,
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
        ],
    )


def _detail() -> PlaceDetail:
    return PlaceDetail(
        id="a15257a",
        friendly_id="Jerusalem",
        name="Jerusalem",
        type="settlement",
        latitude=31.78,
        longitude=35.23,
        confidence="high",
        confidence_score=90,
        status="identified",
        url_slug="jerusalem",
        preceding_article=None,
        modern_name="Jerusalem, Israel",
        verse_count=800,
    )


async def test_browse_returns_page_with_total_and_honesty(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(places_page=_page())) as client:
        resp = await client.get("/api/v1/places/browse")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1340
    # Honesty model carried through verbatim — the unknown place keeps null coordinates.
    assert body["places"][0]["name"] == "Jerusalem"
    assert body["places"][1]["latitude"] is None
    assert body["places"][1]["status"] == "unknown"


async def test_browse_passes_filters_and_pagination_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(places_page=_page())
    async with client_for(fake) as client:
        resp = await client.get(
            "/api/v1/places/browse",
            params={"type": "settlement", "status": "identified", "q": "jer", "limit": 25, "offset": 50},
        )
    assert resp.status_code == 200
    assert fake.last_list_places == {
        "type": "settlement",
        "status": "identified",
        "q": "jer",
        "limit": 25,
        "offset": 50,
    }


async def test_browse_unreachable_is_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # NOT best-effort: an outage on the gazetteer's primary content surfaces as 502 (the UI shows
    # a visible "couldn't load places" state), unlike the Study-notes sidecar.
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/places/browse")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_browse_bad_filter_is_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(
        make_concord(error=ConcordNotFoundError("Concord could not run that places query: 400"))
    ) as client:
        resp = await client.get("/api/v1/places/browse", params={"type": "__nope__"})
    assert resp.status_code == 404


async def test_place_detail_returns_full_record(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(place_detail=_detail())) as client:
        resp = await client.get("/api/v1/places/a15257a")
    assert resp.status_code == 200
    body = resp.json()
    assert body["modern_name"] == "Jerusalem, Israel"
    assert body["verse_count"] == 800
    assert body["status"] == "identified"


async def test_place_detail_unknown_id_is_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("no place 'zzz'"))) as client:
        resp = await client.get("/api/v1/places/zzz")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_place_types_returns_the_vocabulary(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(place_types=["settlement", "region", "mountain"])) as client:
        resp = await client.get("/api/v1/place-types")
    assert resp.status_code == 200
    assert resp.json() == ["settlement", "region", "mountain"]


async def test_place_types_empty_when_concord_does_not_surface_them(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Derive-or-defer: when the vocabulary can't be derived, the endpoint returns [] and the UI
    # hides the type filter — never a hardcoded list that goes stale.
    async with client_for(make_concord(place_types=[])) as client:
        resp = await client.get("/api/v1/place-types")
    assert resp.status_code == 200
    assert resp.json() == []
