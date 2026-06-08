"""Verse of the day (v1.5 Slice 4) — a thin proxy of Concord's `/v1/random` for the Welcome
"verse of the day" card. Stays honest (502 on unreachable, 404 on a Concord 404); the frontend
hides the card on any error so the Welcome page never breaks."""

from collections.abc import Callable

import httpx
from songbird.concord.client import ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import RandomVerse
from tests.conftest import FakeConcordClient


def _verse() -> RandomVerse:
    return RandomVerse(
        translation="WEB",
        book="JHN",
        chapter=3,
        verse=16,
        reference="John 3:16",
        text="For God so loved the world…",
    )


async def test_random_verse_returns_a_shaped_verse(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    async with client_for(make_concord(random=_verse())) as client:
        resp = await client.get("/api/v1/random-verse", params={"translation": "WEB"})
    assert resp.status_code == 200
    assert resp.json() == {
        "translation": "WEB",
        "book": "JHN",
        "chapter": 3,
        "verse": 16,
        "reference": "John 3:16",
        "text": "For God so loved the world…",
    }


async def test_random_verse_passes_translation_through(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = make_concord(random=_verse())
    async with client_for(fake) as client:
        resp = await client.get("/api/v1/random-verse", params={"translation": "BSB"})
    assert resp.status_code == 200
    assert fake.last_random_translation == "BSB"


async def test_random_verse_unreachable_is_502(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    err = ConcordUnreachableError("http://concord.test", httpx.ConnectError("boom"))
    async with client_for(make_concord(error=err)) as client:
        resp = await client.get("/api/v1/random-verse")
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


async def test_random_verse_not_found_is_404(
    make_concord: type[FakeConcordClient],
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    # e.g. an unknown translation — Concord 404s; we stay honest (the frontend hides the card).
    async with client_for(
        make_concord(error=ConcordNotFoundError("could not pick a random verse: 404"))
    ) as client:
        resp = await client.get("/api/v1/random-verse", params={"translation": "ZZZ"})
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NOT_FOUND"
