"""The journeys proxy: Concord's curated Scripture journeys (Paul's missionary journeys, the
Exodus), surfaced as a list, a detail (ordered stops + the one-reconstruction note), and a
reverse lookup. songbird stores none of this — it passes Concord's journeys through verbatim,
honesty model and all (unlocated stops carry null coordinates; `dating` may be null). A bad/unknown
id is a not-found (404), not unreachability (502). Synthetic fixtures only — never real data."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    JourneyDetail,
    JourneysResponse,
    JourneyStop,
    JourneySummary,
    PlaceJourneysResponse,
)
from tests.conftest import FakeConcordClient


def _summary(journey_id: str = "paul-1", dating: str | None = "AD 46–48") -> JourneySummary:
    return JourneySummary(
        id=journey_id,
        name="Paul's First Missionary Journey",
        scripture="Acts 13–14",
        dating=dating,
        stop_count=2,
    )


def _journeys_page() -> JourneysResponse:
    return JourneysResponse(limit=10, offset=20, total=42, journeys=[_summary()])


def _journey_detail() -> JourneyDetail:
    return JourneyDetail(
        id="paul-1",
        name="Paul's First Missionary Journey",
        scripture="Acts 13–14",
        dating=None,  # a debated-dating journey — null tolerated
        source="Curated from Acts",
        note="Sea crossings are drawn as direct lines; the precise route is not asserted.",
        stops=[
            # A located stop …
            JourneyStop(
                ordinal=1,
                place_id="antioch",
                name="Antioch",
                friendly_id="antioch-syria",
                latitude=36.2,
                longitude=36.16,
                confidence="high",
                status="identified",
                reference="Acts 13:1",
            ),
            # … and an UNLOCATED stop (null coords/confidence/status) — listed, never mapped.
            JourneyStop(
                ordinal=2,
                place_id="unknown-port",
                name="An unnamed port",
                friendly_id=None,
                latitude=None,
                longitude=None,
                confidence=None,
                status=None,
                reference=None,
            ),
        ],
    )


# --- list_journeys (the page-out) --------------------------------------------------------------


async def test_list_journeys_pass_through_and_shape(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(journeys_page=_journeys_page())
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/journeys?limit=10&offset=20")
    assert resp.status_code == 200
    body = resp.json()
    # The page-out is {journeys, total} — mirrors PlacesPageOut/TopicsPageOut, no limit/offset echoed.
    assert set(body.keys()) == {"journeys", "total"}
    assert body["total"] == 42
    assert body["journeys"][0]["id"] == "paul-1"
    assert body["journeys"][0]["stop_count"] == 2
    # The limit/offset reached Concord (passthrough).
    assert fake.last_list_journeys == {"limit": 10, "offset": 20}


async def test_list_journeys_defaults(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord()
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/journeys")
    assert resp.status_code == 200
    assert resp.json() == {"journeys": [], "total": 0}
    assert fake.last_list_journeys == {"limit": 50, "offset": 0}


async def test_list_journeys_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/journeys")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


# --- get_journey (the detail) ------------------------------------------------------------------


async def test_get_journey_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(journey=_journey_detail())) as client:
        resp = await client.get("/api/v1/journeys/paul-1")
    assert resp.status_code == 200
    body = resp.json()
    # Metadata incl. source + the one-reconstruction note; dating=null is tolerated.
    assert body["source"] == "Curated from Acts"
    assert "Sea crossings" in body["note"]
    assert body["dating"] is None
    # Ordered stops round-trip; the unlocated stop keeps its null coords (honesty model).
    assert [s["ordinal"] for s in body["stops"]] == [1, 2]
    assert body["stops"][0]["latitude"] == 36.2
    unlocated = body["stops"][1]
    assert unlocated["latitude"] is None and unlocated["longitude"] is None
    assert unlocated["confidence"] is None and unlocated["status"] is None
    assert unlocated["reference"] is None


async def test_get_journey_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown journey"))) as client:
        resp = await client.get("/api/v1/journeys/nope")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_get_journey_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/journeys/paul-1")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


# --- get_place_journeys (the reverse lookup — a bare list) -------------------------------------


async def test_place_journeys_pass_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    page = PlaceJourneysResponse(
        id="antioch", total=1, journeys=[_summary(), _summary(journey_id="paul-2", dating=None)]
    )
    async with client_for(make_concord(place_journeys=page)) as client:
        resp = await client.get("/api/v1/places/antioch/journeys")
    assert resp.status_code == 200
    rows = resp.json()
    # A bare list (no page-out wrapper — reverse lookup).
    assert isinstance(rows, list)
    assert [j["id"] for j in rows] == ["paul-1", "paul-2"]
    assert rows[1]["dating"] is None


async def test_place_journeys_not_found_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(error=ConcordNotFoundError("unknown place"))) as client:
        resp = await client.get("/api/v1/places/nope/journeys")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"


async def test_place_journeys_unreachable_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/places/antioch/journeys")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
