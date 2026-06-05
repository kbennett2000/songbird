"""Live smoke test against a real Concord. Marked `concord`; excluded from the default run.

Run with: `pytest -m concord` (Concord must be reachable at CONCORD_BASE_URL).
"""

import os

import pytest
from songbird.concord.client import ConcordClient

pytestmark = pytest.mark.concord


async def test_live_translations() -> None:
    base_url = os.environ.get("CONCORD_BASE_URL", "http://localhost:8000")
    client = ConcordClient(base_url)
    try:
        translations = await client.list_translations()
    finally:
        await client.aclose()
    assert len(translations) >= 1


async def test_live_health() -> None:
    base_url = os.environ.get("CONCORD_BASE_URL", "http://localhost:8000")
    client = ConcordClient(base_url)
    try:
        health = await client.health()
    finally:
        await client.aclose()
    assert health.status == "ok"
    assert health.translation_count >= 1
