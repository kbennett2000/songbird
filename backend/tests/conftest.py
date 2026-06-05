"""Test fixtures.

The fast suite never needs a live Concord: routes depend on `get_concord_client`, which we
override with a `FakeConcordClient`. The app's lifespan (which builds the real client) is not
run, so tests stay hermetic.
"""

import os

os.environ.setdefault("DATA_DIR", "/tmp/songbird-test-data")

from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI
from songbird.api.deps import get_concord_client
from songbird.concord.schemas import ConcordHealth, Translation
from songbird.main import create_app


class FakeConcordClient:
    """Duck-types ConcordClient for tests. Either returns canned data or raises `error`."""

    def __init__(
        self,
        *,
        health: ConcordHealth | None = None,
        translations: list[Translation] | None = None,
        error: Exception | None = None,
        base_url: str = "http://concord.test",
    ) -> None:
        self._health = health
        self._translations = translations or []
        self._error = error
        self.base_url = base_url

    async def health(self) -> ConcordHealth:
        if self._error is not None:
            raise self._error
        assert self._health is not None
        return self._health

    async def list_translations(self) -> list[Translation]:
        if self._error is not None:
            raise self._error
        return self._translations


@pytest.fixture
def app() -> FastAPI:
    application = create_app()
    return application


@pytest.fixture
def make_concord() -> type[FakeConcordClient]:
    return FakeConcordClient


@pytest.fixture
def client_for(app: FastAPI) -> Callable[[FakeConcordClient], httpx.AsyncClient]:
    def _build(concord: FakeConcordClient) -> httpx.AsyncClient:
        app.dependency_overrides[get_concord_client] = lambda: concord
        transport = httpx.ASGITransport(app=app)
        return httpx.AsyncClient(transport=transport, base_url="http://test")

    return _build
