"""Consumer contract test — songbird vs Concord's published OpenAPI artifact.

songbird's `concord/client.py` + `concord/schemas.py` duplicate Concord's wire contract by
hand, so drift (an endpoint renamed/removed, a HealthResponse field dropped) would otherwise
only surface at runtime. This validates songbird's declared dependency surface against a
committed, version-pinned copy of Concord's `docs/openapi.json`, so such a change fails CI here.

What this artifact lets us pin: (a) the **endpoints** songbird calls (path + method) and the
query parameters it relies on; (b) **HealthResponse** → `ConcordHealth`; and (c), since Concord
v1.3.0 types its v8 responses, every field songbird reads from the translations, notes,
documents and topics (v1.8's surface): each of songbird's models here must find all its fields in
Concord's schema of the same name. Concord's other bodies are still untyped; their drift is caught
by the live nightly suite (`live_concord_test.py`, marked `concord`). The two are complementary:
this one is fast and deterministic (no network) and runs on every PR; the nightly exercises a
real Concord.

A field songbird reads may be required in Concord's schema yet optional in songbird's model: an
older Concord (v1.2.0 and before) sends none of v8's, and songbird must still work against it.

Refresh the fixture when bumping the Concord pin: copy Concord's `docs/openapi.json` at the new
tag to `tests/fixtures/concord-openapi.json`, move the two image pins (docker-compose.yml and the
nightly workflow; `test_every_pin_names_the_fixture_version` checks them) and reconcile any
failures here.
"""

import json
import re
from pathlib import Path

from pydantic import BaseModel
from songbird.concord.schemas import (
    ConcordHealth,
    Document,
    DocumentImage,
    DocumentsResponse,
    DocumentSummary,
    NotePassage,
    NoteSearchHit,
    NoteSearchResponse,
    NotesResponse,
    TopicDetail,
    TopicSourceCount,
    TopicsResponse,
    TopicSummary,
    Translation,
    TranslationsResponse,
    TranslatorNote,
    VerseTopicsResponse,
)

_SPEC_PATH = Path(__file__).parent / "fixtures" / "concord-openapi.json"
_REPO = Path(__file__).resolve().parents[2]

# The Concord endpoints songbird's ConcordClient depends on, as (METHOD, path-template). Path
# parameter *names* don't matter for routing, so both sides are normalized to "{}" before
# comparison — only the structure is the contract. Keep this in lockstep with concord/client.py.
_REQUIRED_ENDPOINTS = {
    ("GET", "/healthz"),
    ("GET", "/v1/translations"),
    ("GET", "/v1/books"),
    ("GET", "/v1/search"),
    ("GET", "/v1/notes/search"),
    ("GET", "/v1/semantic-search"),
    ("GET", "/v1/random"),
    ("GET", "/v1/chapters/{}/{}"),
    ("GET", "/v1/cross-references/{}"),
    ("GET", "/v1/verses/{}/topics"),
    ("GET", "/v1/topics/{}/verses"),
    ("GET", "/v1/topics"),
    ("GET", "/v1/topics/{}"),
    ("GET", "/v1/verses/{}/words"),
    ("GET", "/v1/strongs/{}"),
    ("GET", "/v1/strongs/{}/verses"),
    ("GET", "/v1/journeys"),
    ("GET", "/v1/journeys/{}"),
    ("GET", "/v1/places/{}/journeys"),
    ("GET", "/v1/verses/{}/places"),
    ("GET", "/v1/translations/{}/notes/{}/{}"),
    ("GET", "/v1/translations/{}/headings/{}/{}"),
    ("GET", "/v1/places"),
    ("GET", "/v1/places/{}"),
    ("GET", "/v1/places/{}/verses"),
    ("GET", "/v1/verses/{}"),
    # v1.8, Concord ADR-0012: a chart's or a document's picture, and a Bible's documents.
    ("GET", "/v1/translations/{}/assets/{}"),
    ("GET", "/v1/translations/{}/documents"),
    ("GET", "/v1/translations/{}/documents/{}"),
}

# songbird's own model → Concord's schema it reads (v1.8's surface). The names match except for
# a topic source's count, which Concord calls TopicSourceTotal.
_READ_SCHEMAS: dict[type[BaseModel], str] = {
    Translation: "Translation",
    TranslationsResponse: "TranslationsResponse",
    TranslatorNote: "TranslatorNote",
    NotePassage: "NotePassage",
    NotesResponse: "NotesResponse",
    NoteSearchHit: "NoteSearchHit",
    NoteSearchResponse: "NoteSearchResponse",
    DocumentsResponse: "DocumentsResponse",
    DocumentSummary: "DocumentSummary",
    Document: "Document",
    DocumentImage: "DocumentImage",
    TopicSummary: "TopicSummary",
    TopicDetail: "TopicDetail",
    TopicsResponse: "TopicsResponse",
    TopicSourceCount: "TopicSourceTotal",
    VerseTopicsResponse: "VerseTopicsResponse",
}

_PARAM = re.compile(r"\{[^}]+\}")


def _normalize(path: str) -> str:
    return _PARAM.sub("{}", path)


def _spec() -> dict[str, object]:
    return json.loads(_SPEC_PATH.read_text())


def _props(schema: str) -> dict[str, object]:
    components = _spec()["components"]
    assert isinstance(components, dict)
    schemas = components["schemas"]
    assert isinstance(schemas, dict)
    props = schemas[schema]["properties"]
    assert isinstance(props, dict)
    return props


def _params(path: str) -> set[str]:
    paths = _spec()["paths"]
    assert isinstance(paths, dict)
    return {p["name"] for p in paths[path]["get"]["parameters"]}


def test_fixture_is_the_pinned_concord_version() -> None:
    info = _spec()["info"]
    assert isinstance(info, dict)
    assert info["version"] == "1.3.0"


def test_every_pin_names_the_fixture_version() -> None:
    # The bundled engine and the nightly's service container must be the Concord this fixture
    # describes. (The nightly was left on v1.1.0 when the pin moved to v1.2.0.)
    info = _spec()["info"]
    assert isinstance(info, dict)
    image = f"ghcr.io/kbennett2000/concord:v{info['version']}"
    for pin in ("docker-compose.yml", ".github/workflows/nightly-concord.yml"):
        named = set(re.findall(r"ghcr\.io/kbennett2000/concord:\S+", (_REPO / pin).read_text()))
        assert named == {image}, f"{pin} pins {sorted(named)}, the fixture is {image}"


def test_endpoints_songbird_calls_exist_in_concord_spec() -> None:
    paths = _spec()["paths"]
    assert isinstance(paths, dict)
    available = {
        (method.upper(), _normalize(path)) for path, ops in paths.items() for method in ops
    }
    missing = _REQUIRED_ENDPOINTS - available
    assert not missing, f"Concord no longer exposes endpoints songbird calls: {sorted(missing)}"


def test_search_supports_the_translations_param() -> None:
    # Multi-translation keyword search (v1.3 Slice 1) relies on `/v1/search?translations=`. Pin it
    # so a Concord that drops the param fails here rather than silently degrading to single-result.
    paths = _spec()["paths"]
    assert isinstance(paths, dict)
    params = paths["/v1/search"]["get"]["parameters"]
    names = {p["name"] for p in params}
    assert "translations" in names, "Concord's /v1/search dropped the `translations` param"


def test_health_response_contract() -> None:
    components = _spec()["components"]
    assert isinstance(components, dict)
    schemas = components["schemas"]
    assert isinstance(schemas, dict)
    props = schemas["HealthResponse"]["properties"]

    # Every field songbird's ConcordHealth reads must still be a HealthResponse property...
    for field in ConcordHealth.model_fields:
        assert field in props, f"Concord's HealthResponse no longer carries '{field}'"
    # ...with a compatible JSON type (the counts drive the /healthz reachability report).
    assert props["status"]["type"] == "string"
    for count in (
        "translation_count",
        "verse_count",
        "cross_ref_count",
        "book_count",
        "place_count",
    ):
        assert props[count]["type"] == "integer"


def test_every_field_songbird_reads_is_in_concords_schema() -> None:
    # Each model's fields, as Concord names them, must be properties of its schema: a field
    # Concord renamed or dropped would otherwise just arrive as null.
    for model, schema in _READ_SCHEMAS.items():
        props = _props(schema)
        for name, field in model.model_fields.items():
            key = field.alias or name
            assert key in props, f"Concord's {schema} no longer carries '{key}' ({model.__name__})"


def test_v8_note_fields() -> None:
    # Spelled out as well, so a model edit can't quietly shrink what's checked (ADR-0011/0012).
    note = {"type", "label", "title", "text_format", "passages", "image"}
    assert note <= _props("TranslatorNote").keys()
    assert {"label", "title", "text_format", "image"} <= _props("NoteSearchHit").keys()
    assert "total" in _props("NoteSearchResponse")
    assert {
        "start_chapter",
        "start_verse",
        "end_chapter",
        "end_verse",
        "reference",
    } <= _props("NotePassage").keys()
    assert {"note_count", "document_count"} <= _props("Translation").keys()
    assert _props("Translation")["note_count"]["type"] == "integer"
    assert _props("Translation")["document_count"]["type"] == "integer"


def test_assets_serve_jpeg_and_png() -> None:
    # songbird relays only these two (v1.8 slice B); anything else from Concord is a 502. (Concord's
    # OpenAPI doesn't list its 304 on If-None-Match; `chart_images_test.py` covers songbird's side.)
    paths = _spec()["paths"]
    assert isinstance(paths, dict)
    ok = paths["/v1/translations/{translation}/assets/{name}"]["get"]["responses"]["200"]
    assert {"image/jpeg", "image/png"} <= ok["content"].keys()


def test_documents_contract() -> None:
    # A Bible's introductions and About page (v1.8 slices C1 and C2).
    assert {"kind", "book"} <= _params("/v1/translations/{translation}/documents")
    assert {"translation", "book", "kind", "total", "documents"} <= _props(
        "DocumentsResponse"
    ).keys()
    assert {"slug", "kind", "title", "book", "ordinal"} <= _props("DocumentSummary").keys()
    assert {"slug", "kind", "title", "book", "ordinal", "text", "images"} <= _props(
        "Document"
    ).keys()
    assert {"name", "media_type", "width", "height"} <= _props("DocumentImage").keys()


def test_topics_by_source_contract() -> None:
    # Topics from more than one index (v1.8 slice D, Concord ADR-0013).
    assert "source" in _params("/v1/topics")
    assert "source" in _props("TopicSummary")
    assert "source" in _props("TopicDetail")
    assert {"source", "sources"} <= _props("TopicsResponse").keys()
    assert {"source", "total"} <= _props("TopicSourceTotal").keys()
