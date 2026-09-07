"""`/healthz` — songbird liveness plus a Concord reachability probe.

songbird is "ok" whenever the process is up; Concord's reachability is reported separately
in the body. The endpoint stays HTTP 200 even when Concord is down (it's a status report,
not a hard dependency check), so it's a reliable at-a-glance signal.

It reports *which* Concord answered and *what corpus* it serves, not just that something
did. songbird's whole Scripture surface is whatever the configured Concord happens to hold
(invariant 2 — the location is config), so "reachable" alone can't tell you that you're
pointed at the right one. A wrong address answers 200 just as cheerfully as the right one;
only the translation list gives it away.
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
    # The ids Concord actually serves (e.g. ["ASV", "ESV", "KJV", …]) — the detail that makes
    # a wrong-Concord misconfiguration visible instead of merely countable. None when Concord
    # is unreachable, or on the narrow case where /healthz answered but the listing didn't.
    translation_ids: list[str] | None = None
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
        # Reachability is decided by /healthz alone; the listing is a second, softer call.
        # If it fails after /healthz succeeded, Concord is still up — say so, and leave the
        # ids unknown rather than reporting the whole dependency down.
        try:
            translation_ids = [t.id for t in await concord.list_translations()]
        except ConcordUnreachableError:
            translation_ids = None
        concord_status = ConcordStatus(
            base_url=concord.base_url,
            reachable=True,
            status=health.status,
            translation_count=health.translation_count,
            translation_ids=translation_ids,
        )
    return HealthResponse(status="ok", version=__version__, concord=concord_status)
