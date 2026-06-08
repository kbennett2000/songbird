# songbird — Places (Gazetteer) (v1.4 feature spec)

> songbird is built on **[Concord](https://github.com/kbennett2000/concord)**, which owns all
> place data. This spec adds a way to explore that data; the v1.1 map
> ([MAP-SPEC](../v1.1/MAP-SPEC.md)) renders the places in the passage you're reading — this is
> the companion that lets you explore the **whole** gazetteer.

Today songbird shows only the places named in the chapter you're reading, on a map. Concord knows
**~1,340 biblical places** with a stable id, type, status, confidence, modern name, and the
verses each appears in. This adds a standalone **gazetteer**: browse all of them (filter by type,
status, name), and open a **place detail** — modern name, how honestly it's located, and every
verse that names it, each a jump into the reader.

This is a **v1.4 feature**, gated on the Concord pin bump in
[SEARCH-EXPANSION-SPEC §Slice 0](../v1.3/SEARCH-EXPANSION-SPEC.md) (the geography endpoints exist
since v1.0.0, but all post-bump work shares that pin).

---

## 1. What this is (and is not)

**Is:** a browsable, filterable list of every place Concord knows, and a detail view per place
(name + modern name, type, status + confidence with the honesty model surfaced, coordinates when
located, and the verses that mention it). Read-only.

**Is not:** a global map of all places at once (the v1.1 map stays per-passage; a whole-world
slippy map is future), no journeys/routes (a possible future Concord capability), no editing
(Concord owns the data).

## 2. The boundary — a pure songbird slice

**No Concord change.** Concord already exposes `GET /v1/places` (browse; filters `type`,
`status`, `q`; paginated) and `GET /v1/places/{id}` (detail), and songbird already proxies
`GET /v1/places/{id}/verses` (place → verses). This slice wires the two it doesn't use yet and
adds a screen. The **honesty model** (null coordinates / null confidence for
unknown/symbolic/multiple places) is carried through verbatim — songbird never fabricates a
coordinate (reuse the existing presentation from the map/Geography work).

## 3. Concord contract used

- `GET /v1/places?type=&status=&q=&limit=&offset=` →
  `{type, status, q, limit, offset, total, places: [PlaceSummary]}`.
- `GET /v1/places/{id}` → `PlaceDetail` (`id, friendly_id, name, url_slug, type,
  preceding_article, latitude, longitude, confidence, confidence_score, status, modern_name,
  verse_count`).
- `GET /v1/places/{id}/verses` — already proxied (`get_place_verses`), reused for the detail's
  verse list.

`status` is the fixed set `identified | disputed | unknown | symbolic | multiple`; `type` is a
dynamic set — fetch the available types from the data rather than hardcoding (Concord returns an
`available` list on an unknown-type filter error; or derive from results).

## 4. songbird changes

- **Client** (`concord/client.py`): `list_places(type?, status?, q?, limit, offset)` →
  `PlacesResponse`; `get_place(id)` → `PlaceDetail`. (`get_place_verses` exists.) Unreachable →
  `ConcordUnreachableError`; `404` → `ConcordNotFoundError`.
- **Concord schema** (`concord/schemas.py`): `PlaceDetail` (the detail fields the UI shows) and a
  `PlacesPage` (`places`, `total` for pagination). The summary `Place` already exists.
- **songbird API**: `GET /api/v1/places/browse` (browse — passthrough of the filters +
  pagination) and `GET /api/v1/places/{id}` (detail), plus `GET /api/v1/place-types` (the derived
  `type` vocabulary). `api/schemas.py` gains the matching response models. Unreachable → `502`;
  `404` → `404`. (Browse is `/places/browse`, **not** `/api/v1/places` — that path is already the
  per-chapter map endpoint; reality-corrects-spec, Slice 3.) The `type` options come from
  Concord's unknown-type-error `available` list (`/api/v1/place-types`), with a graceful `[]`
  fallback so the UI hides the type filter rather than ever hardcoding a list that goes stale.
- **Frontend** — a new route `/places`:
  - **List**: filter by `type` and `status`, text search by name (`q`), paginated. Each row:
    name, type, status, modern name (when present), with unknown/symbolic places clearly marked.
  - **Detail** (`/places/:id` or a modal): name + modern name, type, status + confidence
    (honesty model), coordinates when located, and the **verse list** (from `get_place_verses`),
    each "Open in reader". A "view on map" reusing the existing `MapView` for a single located
    point is a nice-to-have, not required.
  - A **Welcome** quick-link ("Places — explore the biblical world") and/or a nav entry.

## 5. Tests

- Backend (`places_test.py`): browse with `type`/`status`/`q` filters and pagination; unknown
  filter handling; detail; `404`; unreachable → `502`. `FakeConcordClient` gains
  `list_places`/`get_place`.
- Frontend: list renders + filters work; detail renders the honesty model + verse list; verse
  jump targets the reader. MSW handlers for both endpoints.
- Contract (**required**): add `("GET", "/v1/places")` and `("GET", "/v1/places/{}")` to
  `_REQUIRED_ENDPOINTS` (both in the v1.1.0 fixture).

## 6. Definition of done

Browse all places with type/status/name filters + pagination; open a detail with its verses and
the honesty model surfaced; jumps work; the contract test pins the two endpoints; tests/types/
lint green; a dev-notes entry.

## 7. Invariants (CLAUDE.md)

Consume Concord over HTTP through the one client; carry the honesty model through verbatim (no
fabricated coordinates); branch + PR per slice; tests required; types/lint clean; never
self-merge, push to `main`, or `--force`.
