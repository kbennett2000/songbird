"""A translation's documents — book introductions — passed through from Concord (v1.8 slice C1;
Concord ADR-0012, V8-S5).

`GET /api/v1/translations/{translation}/documents` lists them and
`GET /api/v1/translations/{translation}/documents/{slug}` returns one, at request time — songbird
stores none (invariants 1 and 5). Made-up text and names only: never a real study Bible's
introduction.
"""

from collections.abc import Callable

import httpx
import pytest
from songbird.concord.client import ConcordClient, ConcordNotFoundError, ConcordUnreachableError
from songbird.concord.schemas import (
    Document,
    DocumentImage,
    DocumentsResponse,
    DocumentSummary,
    Translation,
)
from tests.conftest import FakeConcordClient

_TEXT = (
    "## A MADE-UP HEADING\n\nA made-up paragraph with [a link](ref:GEN.1.1).\n\n"
    "![A made-up caption](asset:made-up-gen.jpg)\n\n- 1000 B.C.\\\n  **A MADE-UP EVENT**"
)
_SUMMARY = DocumentSummary(
    slug="introduction-gen", kind="book-introduction", title="Made-up Genesis", book="GEN", ordinal=1
)
_LIST = DocumentsResponse(
    translation="EMB", book=None, kind="book-introduction", total=1, documents=[_SUMMARY]
)
_DOCUMENT = Document(
    translation="EMB",
    slug="introduction-gen",
    kind="book-introduction",
    title="Made-up Genesis",
    book="GEN",
    ordinal=1,
    text=_TEXT,
    images=[DocumentImage(name="made-up-gen.jpg", media_type="image/jpeg", width=1024, height=180)],
)
_DOWN = ConcordUnreachableError("http://concord.test", ConnectionError("down"))


# --- The routes ---


async def test_the_list_passes_through_with_its_filters(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(documents=_LIST)
    async with client_for(fake) as client:
        response = await client.get(
            "/api/v1/translations/EMB/documents", params={"kind": "book-introduction"}
        )
    assert response.status_code == 200
    assert response.json() == _LIST.model_dump()
    assert fake.documents_calls == [("EMB", "book-introduction", None)]


async def test_the_list_forwards_a_book_and_asks_with_no_filter_when_none_is_given(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient()
    async with client_for(fake) as client:
        await client.get("/api/v1/translations/EMB/documents", params={"book": "GEN"})
        empty = await client.get("/api/v1/translations/KJV/documents")
    assert fake.documents_calls == [("EMB", None, "GEN"), ("KJV", None, None)]
    # A translation with no documents is a normal, empty answer.
    assert empty.status_code == 200
    assert empty.json()["documents"] == []


async def test_a_document_passes_through_with_its_text_and_pictures(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(document=_DOCUMENT)
    async with client_for(fake) as client:
        response = await client.get("/api/v1/translations/EMB/documents/introduction-gen")
    assert response.status_code == 200
    body = response.json()
    assert body == _DOCUMENT.model_dump()
    assert body["text"] == _TEXT  # the Markdown is untouched
    assert body["images"][0] == {
        "name": "made-up-gen.jpg",
        "media_type": "image/jpeg",
        "width": 1024,
        "height": 180,
    }
    assert fake.document_calls == [("EMB", "introduction-gen")]


@pytest.mark.parametrize(
    "path", ["/api/v1/translations/EMB/documents", "/api/v1/translations/EMB/documents/nope"]
)
async def test_what_concord_lacks_is_a_404(
    path: str, client_for: Callable[[FakeConcordClient], httpx.AsyncClient]
) -> None:
    # An unknown translation, kind, book or slug — or a Concord that predates documents.
    fake = FakeConcordClient(error=ConcordNotFoundError("no such documents"))
    async with client_for(fake) as client:
        response = await client.get(path)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    "path", ["/api/v1/translations/EMB/documents", "/api/v1/translations/EMB/documents/a-slug"]
)
async def test_an_unreachable_concord_is_a_502(
    path: str, client_for: Callable[[FakeConcordClient], httpx.AsyncClient]
) -> None:
    async with client_for(FakeConcordClient(error=_DOWN)) as client:
        response = await client.get(path)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "CONCORD_UNREACHABLE"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/translations/EMB/documents/%2E%2E",
        "/api/v1/translations/EMB/documents/%2E",
        "/api/v1/translations/%2E%2E/documents/introduction-gen",
        "/api/v1/translations/%2E%2E/documents",
    ],
)
async def test_dot_segments_are_refused_before_any_call(
    path: str, client_for: Callable[[FakeConcordClient], httpx.AsyncClient]
) -> None:
    fake = FakeConcordClient(document=_DOCUMENT, documents=_LIST)
    async with client_for(fake) as client:
        response = await client.get(path)
    assert response.status_code == 404
    assert fake.document_calls == []
    assert fake.documents_calls == []


async def test_signed_out_is_a_401_and_never_reaches_concord(
    unauth_client: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    fake = FakeConcordClient(document=_DOCUMENT, documents=_LIST)
    async with unauth_client(fake) as client:
        listed = await client.get("/api/v1/translations/EMB/documents")
        one = await client.get("/api/v1/translations/EMB/documents/introduction-gen")
    assert (listed.status_code, one.status_code) == (401, 401)
    assert fake.documents_calls == [] and fake.document_calls == []


async def test_translations_pass_document_count_through_and_null_when_absent(
    client_for: Callable[[FakeConcordClient], httpx.AsyncClient],
) -> None:
    def tr(id_: str, document_count: int | None) -> Translation:
        return Translation(
            id=id_, name=id_, language="en", versification="standard", document_count=document_count
        )

    fake = FakeConcordClient(translations=[tr("EMB", 66), tr("KJV", 0), tr("OLD", None)])
    async with client_for(fake) as client:
        response = await client.get("/api/v1/translations")
    counts = {t["id"]: t["document_count"] for t in response.json()["translations"]}
    assert counts == {"EMB": 66, "KJV": 0, "OLD": None}


# --- The client ---


def _concord(handler: Callable[[httpx.Request], httpx.Response]) -> ConcordClient:
    return ConcordClient("http://concord.test", transport=httpx.MockTransport(handler))


async def test_the_client_lists_with_its_filters_and_parses_the_answer() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_LIST.model_dump())

    client = _concord(handler)
    listed = await client.list_documents("EMB", kind="book-introduction", book="GEN")
    unfiltered = await client.list_documents("EMB")
    await client.aclose()
    assert seen[0].url.path == "/v1/translations/EMB/documents"
    assert dict(seen[0].url.params) == {"kind": "book-introduction", "book": "GEN"}
    assert dict(seen[1].url.params) == {}
    assert listed == _LIST and unfiltered == _LIST


async def test_the_client_asks_for_the_encoded_slug_and_parses_the_document() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        # Concord may add fields songbird doesn't model; they are ignored.
        return httpx.Response(200, json={**_DOCUMENT.model_dump(), "extra": 1})

    client = _concord(handler)
    document = await client.get_document("EMB", "intro gen")
    await client.aclose()
    assert seen[0].url.raw_path == b"/v1/translations/EMB/documents/intro%20gen"
    assert document == _DOCUMENT


async def test_the_client_parses_document_count_and_its_absence() -> None:
    entry = {"name": "x", "language": "en", "versification": "standard", "attribution": None}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"translations": [{**entry, "id": "EMB", "document_count": 66}, {**entry, "id": "KJV"}]},
        )

    client = _concord(handler)
    translations = await client.list_translations()
    await client.aclose()
    assert [(t.id, t.document_count) for t in translations] == [("EMB", 66), ("KJV", None)]


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (404, ConcordNotFoundError),  # unknown translation or slug, or an older Concord
        (400, ConcordNotFoundError),  # unknown kind or book
        (500, ConcordUnreachableError),
    ],
)
async def test_the_client_maps_concords_errors(status: int, error: type[Exception]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"code": "made_up"}})

    client = _concord(handler)
    with pytest.raises(error):
        await client.list_documents("EMB", kind="book-introduction")
    with pytest.raises(error):
        await client.get_document("EMB", "introduction-gen")
    await client.aclose()


async def test_the_client_reads_a_dropped_connection_as_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    client = _concord(handler)
    with pytest.raises(ConcordUnreachableError):
        await client.get_document("EMB", "introduction-gen")
    await client.aclose()
