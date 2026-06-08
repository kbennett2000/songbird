# ADR 0003 — MapLibre GL renderer over bundled, offline PMTiles

- **Status:** Accepted
- **Date:** 2026-06-08
- **Context:** songbird Map View detail (issue #76); amends [ADR 0001](0001-offline-bundled-equirectangular-basemap.md) and [ADR 0002](0002-vector-basemap-and-pan-zoom.md)

## Context

ADR 0002 made the basemap a vector SVG with hand-rolled CSS-transform pan/zoom. That hit its
ceiling: zoomed in, the map was still "very sparse" (#76) — flat parchment, no terrain — and the
hand-rolled interaction had two bugs (pan could slide the map off-screen; cluster clicks left a
stale card). The ask was real zoom-dependent detail with **natural-color relief**.

The non-negotiable constraint is unchanged from ADR 0001/0002: songbird works **fully offline
except for Concord** — no tile server, no map CDN, no runtime network call for the map. Data size
is *not* a constraint (the user is fine bundling tens of MB).

## Decision

1. **Adopt MapLibre GL JS as a runtime map library** — explicitly reversing ADR 0001/0002's
   "no map SDK" stance. It's the first real map runtime dependency; justified because the offline
   invariant is *preserved*, not weakened (below), and the detail/interaction payoff is large.

2. **All map data is bundled and served locally.** Two committed assets (built dev-time by
   `scripts/tilegen/`, see ADR-0002-style discipline) are served by songbird's own backend:
   - `relief.pmtiles` — natural-color shaded-relief raster tiles (Natural Earth, public domain),
     read via the `pmtiles://` protocol over HTTP **Range**.
   - `bible-physical.geojson` — 1:10m coastlines, rivers, lakes, playas, reefs, minor islands.
   The MapLibre style is a **JS object, never a URL**. **No glyphs/sprite are bundled or fetched**:
   all text (cluster counts, curated labels) is drawn as **DOM markers**, and there are no
   `symbol`/`text` GL layers — so there is no font-CDN dependency to leak the offline promise.
   The map makes **zero outbound calls**; `CONCORD_BASE_URL` remains the only runtime external.

3. **Web Mercator replaces plate-carrée.** MapLibre projects lng/lat natively, so the linear
   `projection.ts`/`mapBounds.ts` math is retired. Places are a clustered GeoJSON source; pins are
   `circle` layers colored data-drivenly by the honesty **tier**; per-chapter framing is
   `fitBounds`; the scroll-off bug is fixed by **`maxBounds`**; the cluster-click bug is fixed by
   native clustering (`getClusterExpansionZoom` + `getClusterLeaves`, which also lists members).

4. **Physical-only, public-domain, honest.** Relief + coastlines + rivers + lakes + reefs + curated
   labels (seas/regions/rivers/mountains/deserts). **No roads, modern cities, POIs, or political
   boundaries** — by deliberate omission, for ancient-world honesty. A `style.test.ts` whitelist
   asserts no such layer can sneak in.

## Consequences

- **Offline invariant intact**, and re-asserted by tests: `style.test.ts` checks the style has no
  `glyphs` and no `symbol` layers and reads only same-origin `pmtiles://`/geojson; a backend test
  checks `/tiles` serves Range (`206`); the manual gate loads the map with all non-`/api`/`/tiles`
  network blocked.
- **Pin-accuracy gate moves.** ADR 0001's `projection.test.ts` is gone; its role transfers to
  `places.ts` unit tests (coords → `[lon,lat]` GeoJSON, correct tier) plus a live render check.
- **WebGL is untestable in happy-dom.** Mitigation: the pure layer (`config`/`places`/`bounds`/
  `labels`/`markers`/`style`) is unit-tested hard; the component test mocks `maplibre-gl`/`pmtiles`
  to assert wiring (maxBounds, sources/layers, click → PlaceCard, cluster → members + zoom);
  real rendering is verified live (Playwright/manual).
- **Bundle + image grow.** `maplibre-gl` is ~300 KB gz — isolated into a lazily-loaded `MapView`
  chunk so the reader's initial load is unchanged. Committed tiles add ~7.5 MB to the repo/image
  (plain-committed; Git LFS is an option if that grows).
- **Dead code removed:** `lib/{projection,mapTransform,cluster,mapBounds,mapLabels}.ts`, the SVG
  asset, and `scripts/mapgen/` (superseded by `scripts/tilegen/`).

## Alternatives considered

- **Keep the SVG, just add more vectors/relief by hand** — rejected: no real zoom-dependent detail
  or terrain, and we'd keep maintaining a bespoke pan/zoom/cluster engine (the source of the bugs).
- **A hosted tile service / map CDN (Mapbox, OSM tiles, remote glyphs)** — rejected again, same as
  ADR 0001/0002: breaks offline. The whole point here is that MapLibre runs against *local* data.
- **Vector tiles (tippecanoe/PMTiles) for the physical layer instead of GeoJSON** — viable and more
  scalable, but the clipped 1:10m GeoJSON is only ~760 KB and avoids a heavier dev toolchain; can be
  revisited if the overlay ever grows.
