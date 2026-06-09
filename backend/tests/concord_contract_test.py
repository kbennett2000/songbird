"""Consumer contract test — songbird vs Concord's published OpenAPI artifact.

songbird's `concord/client.py` + `concord/schemas.py` duplicate Concord's wire contract by
hand, so drift (an endpoint renamed/removed, a HealthResponse field dropped) would otherwise
only surface at runtime. This validates songbird's declared dependency surface against a
committed, version-pinned copy of Concord's `docs/openapi.json`, so such a change fails CI here.

What this artifact lets us pin: Concord types only a handful of response bodies in its OpenAPI
(most endpoints return untyped bodies), so this covers (a) the **endpoints** songbird calls
(path + method) and (b) the one richly-typed response songbird depends on (**HealthResponse** →
`ConcordHealth`). Full response-body drift on the untyped endpoints is caught by the live
nightly suite (`live_concord_test.py`, marked `concord`). The two are complementary: this one
is fast and deterministic (no network) and runs on every PR; the nightly exercises a real
Concord.

Refresh the fixture when bumping the Concord pin: copy Concord's `docs/openapi.json` to
`tests/fixtures/concord-openapi.json` and reconcile any failures here.
"""

import json
import re
from pathlib import Path

from songbird.concord.schemas import ConcordHealth

_SPEC_PATH = Path(__file__).parent / "fixtures" / "concord-openapi.json"

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
    ("GET", "/v1/verses/{}/places"),
    ("GET", "/v1/translations/{}/notes/{}/{}"),
    ("GET", "/v1/translations/{}/headings/{}/{}"),
    ("GET", "/v1/places"),
    ("GET", "/v1/places/{}"),
    ("GET", "/v1/places/{}/verses"),
    ("GET", "/v1/verses/{}"),
}

_PARAM = re.compile(r"\{[^}]+\}")


def _normalize(path: str) -> str:
    return _PARAM.sub("{}", path)


def _spec() -> dict[str, object]:
    return json.loads(_SPEC_PATH.read_text())


def test_fixture_is_the_pinned_concord_version() -> None:
    # Guards against the fixture silently drifting from the docker-compose pin (CONCORD_VERSION).
    info = _spec()["info"]
    assert isinstance(info, dict)
    assert info["version"] == "1.2.0"


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
