"""Journeys — Concord's curated Scripture journeys (Paul's missionary journeys, the Exodus): an
ordered walk of stops, each tied to a passage, with a per-journey honesty model (per-stop
confidence/status, unlocated stops, a one-reconstruction note). songbird owns no journey data;
these routes pass Concord's journeys through verbatim. Same proxy shape as topics/places — a
bad/unknown id is a not-found (404), not unreachability (502)."""

from fastapi import APIRouter, Depends

from songbird.api.deps import get_concord_client
from songbird.api.schemas import JourneyDetail, JourneysPageOut, JourneyStop, JourneySummary
from songbird.concord.client import (
    ConcordClient,
    ConcordNotFoundError,
    ConcordUnreachableError,
)
from songbird.core.errors import ErrorCode, raise_http

router = APIRouter(prefix="/api/v1", tags=["journeys"])


@router.get("/journeys", response_model=JourneysPageOut)
async def browse_journeys(
    limit: int = 50,
    offset: int = 0,
    concord: ConcordClient = Depends(get_concord_client),
) -> JourneysPageOut:
    """Browse the curated journeys, paginated (no filters — the endpoint takes only limit/offset).
    A bad request → 404; unreachable → 502."""
    try:
        page = await concord.list_journeys(limit=limit, offset=offset)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    journeys = [
        JourneySummary(
            id=j.id,
            name=j.name,
            scripture=j.scripture,
            dating=j.dating,
            stop_count=j.stop_count,
        )
        for j in page.journeys
    ]
    return JourneysPageOut(journeys=journeys, total=page.total)


@router.get("/journeys/{journey_id}", response_model=JourneyDetail)
async def journey_detail(
    journey_id: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> JourneyDetail:
    """One journey's full detail: metadata, `source`, the one-reconstruction `note`, and the
    ordered stops (unlocated stops carry null coordinates — the honesty model passes through). A
    404 is a real not-found."""
    try:
        result = await concord.get_journey(journey_id)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return JourneyDetail(
        id=result.id,
        name=result.name,
        scripture=result.scripture,
        dating=result.dating,
        source=result.source,
        note=result.note,
        stops=[
            JourneyStop(
                ordinal=s.ordinal,
                place_id=s.place_id,
                name=s.name,
                friendly_id=s.friendly_id,
                latitude=s.latitude,
                longitude=s.longitude,
                confidence=s.confidence,
                status=s.status,
                reference=s.reference,
            )
            for s in result.stops
        ],
    )


@router.get("/places/{place_id}/journeys", response_model=list[JourneySummary])
async def place_journeys(
    place_id: str,
    concord: ConcordClient = Depends(get_concord_client),
) -> list[JourneySummary]:
    """The journeys that pass through a place (the inverse lookup) — a bare list. A 404 is a real
    not-found."""
    try:
        result = await concord.get_place_journeys(place_id)
    except ConcordNotFoundError as exc:
        raise_http(404, ErrorCode.NOT_FOUND, str(exc))
    except ConcordUnreachableError as exc:
        raise_http(502, ErrorCode.CONCORD_UNREACHABLE, str(exc))
    return [
        JourneySummary(
            id=j.id,
            name=j.name,
            scripture=j.scripture,
            dating=j.dating,
            stop_count=j.stop_count,
        )
        for j in result.journeys
    ]
