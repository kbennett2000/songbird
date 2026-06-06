"""Scope CRUD: the three tiers round-trip, and scope codes are validated against Concord."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordUnreachableError
from tests.conftest import FakeConcordClient
from tests.helpers import DEFAULT_TRANSLATIONS

ANCHOR = {
    "book_usfm": "JHN",
    "start_chapter": 3,
    "start_verse": 16,
    "end_chapter": 3,
    "end_verse": 16,
    "note_markdown": "note",
}


def _concord() -> FakeConcordClient:
    return FakeConcordClient(translations=DEFAULT_TRANSLATIONS)


async def test_scope_all_has_no_codes(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        resp = await client.post("/api/v1/annotations", json={**ANCHOR, "scope_type": "all"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["scope_type"] == "all"
    assert body["scope_translations"] == []


async def test_scope_current_resolves_to_single_code(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        resp = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "current", "translations": ["KJV"]},
        )
        assert resp.status_code == 201
        annotation_id = resp.json()["id"]
        assert resp.json()["scope_translations"] == ["KJV"]

        # Round-trips on GET.
        fetched = await client.get(f"/api/v1/annotations/{annotation_id}")
    assert fetched.json()["scope_type"] == "current"
    assert fetched.json()["scope_translations"] == ["KJV"]


async def test_scope_subset_stores_codes(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        resp = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "subset", "translations": ["KJV", "web"]},
        )
    assert resp.status_code == 201
    assert resp.json()["scope_translations"] == ["KJV", "WEB"]  # normalized upper-case


async def test_update_changes_scope_and_replaces_codes(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        created = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "subset", "translations": ["KJV", "WEB"]},
        )
        annotation_id = created.json()["id"]
        patched = await client.patch(
            f"/api/v1/annotations/{annotation_id}",
            json={"scope_type": "current", "translations": ["ASV"]},
        )
    assert patched.status_code == 200
    assert patched.json()["scope_type"] == "current"
    assert patched.json()["scope_translations"] == ["ASV"]


async def test_invalid_translation_code_rejected(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        resp = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "current", "translations": ["NOPE"]},
        )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "INVALID_TRANSLATION"


async def test_current_requires_exactly_one_code(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        zero = await client.post(
            "/api/v1/annotations", json={**ANCHOR, "scope_type": "current", "translations": []}
        )
        two = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "current", "translations": ["KJV", "WEB"]},
        )
    assert zero.status_code == 422 and zero.json()["detail"]["code"] == "INVALID_SCOPE"
    assert two.status_code == 422 and two.json()["detail"]["code"] == "INVALID_SCOPE"


async def test_subset_requires_at_least_one_code(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(_concord()) as client:
        resp = await client.post(
            "/api/v1/annotations", json={**ANCHOR, "scope_type": "subset", "translations": []}
        )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "INVALID_SCOPE"


async def test_scope_validation_requires_concord(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # Validating a scope's codes needs Concord; if it's unreachable, creating a scoped
    # annotation errors 502 (consistent with Concord being a hard dependency). 'all' is exempt.
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        scoped = await client.post(
            "/api/v1/annotations",
            json={**ANCHOR, "scope_type": "current", "translations": ["KJV"]},
        )
        unscoped = await client.post("/api/v1/annotations", json={**ANCHOR, "scope_type": "all"})
    assert scoped.status_code == 502
    assert scoped.json()["detail"]["code"] == "CONCORD_UNREACHABLE"
    assert unscoped.status_code == 201  # 'all' needs no Concord call
