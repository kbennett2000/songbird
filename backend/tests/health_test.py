from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordUnreachableError
from songbird.concord.schemas import ConcordHealth, Translation
from tests.conftest import FakeConcordClient


def _t(translation_id: str) -> Translation:
    return Translation(
        id=translation_id, name=translation_id, language="en", versification="standard"
    )


async def test_app_boots_healthz_ok(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(health=ConcordHealth(status="ok", translation_count=13))
    async with client_for(concord) as client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200


async def test_healthz_shape_concord_up(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    concord = make_concord(
        health=ConcordHealth(status="ok", translation_count=3),
        translations=[_t("ESV"), _t("KJV"), _t("NKJV")],
        base_url="http://concord.test",
    )
    async with client_for(concord) as client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)
    assert body["concord"] == {
        "base_url": "http://concord.test",
        "reachable": True,
        "status": "ok",
        "translation_count": 3,
        "translation_ids": ["ESV", "KJV", "NKJV"],
        "error": None,
    }


async def test_healthz_concord_unreachable(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    concord = make_concord(error=err, base_url="http://concord.test")
    async with client_for(concord) as client:
        resp = await client.get("/healthz")
    # songbird stays alive (200) and reports the dependency as down in the body.
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["concord"]["reachable"] is False
    assert body["concord"]["status"] is None
    assert body["concord"]["translation_count"] is None
    assert body["concord"]["translation_ids"] is None
    assert body["concord"]["error"]


async def test_healthz_names_the_translations_the_configured_concord_serves(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    """The regression this endpoint exists to make visible.

    Pointing songbird at the wrong Concord is not an error state — the wrong one is up, healthy
    and answers everything. The only symptom is a corpus you didn't expect, so /healthz has to
    report the address *and* what that address serves, together.
    """
    public_domain_only = make_concord(
        health=ConcordHealth(status="ok", translation_count=2),
        translations=[_t("KJV"), _t("WEB")],
        base_url="http://concord:8000",
    )
    async with client_for(public_domain_only) as client:
        body = (await client.get("/healthz")).json()
    # Reachable, healthy, and still the wrong Concord — visible only via the corpus.
    assert body["concord"]["reachable"] is True
    assert body["concord"]["base_url"] == "http://concord:8000"
    assert body["concord"]["translation_ids"] == ["KJV", "WEB"]
    assert "ESV" not in body["concord"]["translation_ids"]
