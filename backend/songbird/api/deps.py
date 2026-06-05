"""FastAPI dependencies."""

from fastapi import Request

from songbird.concord.client import ConcordClient


def get_concord_client(request: Request) -> ConcordClient:
    """Return the process-wide Concord client built in the app lifespan.

    Overridden in tests to inject a fake — no live Concord needed for the fast suite.
    """
    client: ConcordClient = request.app.state.concord
    return client
