"""`/healthz` — songbird liveness plus a Concord reachability probe.

songbird is "ok" whenever the process is up; Concord's reachability is reported separately
in the body. The endpoint stays HTTP 200 even when Concord is down (it's a status report,
not a hard dependency check), so it's a reliable at-a-glance signal.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from songbird import __version__
from songbird.api.deps import get_concord_client
from songbird.concord.client import ConcordClient, ConcordUnreachableError

router = APIRouter(tags=["health"])


class ConcordStatus(BaseModel):
    base_url: str
    reachable: bool
    status: str | None = None
    translation_count: int | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    concord: ConcordStatus


@router.get("/healthz", response_model=HealthResponse)
async def healthz(concord: ConcordClient = Depends(get_concord_client)) -> HealthResponse:
    try:
        health = await concord.health()
    except ConcordUnreachableError as exc:
        concord_status = ConcordStatus(
            base_url=concord.base_url,
            reachable=False,
            error=str(exc),
        )
    else:
        concord_status = ConcordStatus(
            base_url=concord.base_url,
            reachable=True,
            status=health.status,
            translation_count=health.translation_count,
        )
    return HealthResponse(status="ok", version=__version__, concord=concord_status)
