# ADR 0002 — Vector (SVG) basemap, client-side pan/zoom, and curated labels

- **Status:** Superseded by [ADR 0003](0003-maplibre-offline-pmtiles-basemap.md)
- **Date:** 2026-06-08
- **Context:** songbird Map View UX (issue #76); amends [ADR 0001](0001-offline-bundled-equirectangular-basemap.md)
- **Superseded:** The hand-rolled vector-SVG basemap and CSS-transform pan/zoom here were short-lived —
  ADR 0003 moved to MapLibre GL over bundled PMTiles (real relief, native pan/zoom/clustering) the
  same day. The offline-and-honest goals carry forward; the bespoke pan/zoom engine was retired.
  Kept for the decision history.

## Context

ADR 0001 established the Map View as a **single bundled raster PNG** plotted with songbird's own
equirectangular transform, shown at a **fixed full-extent fit** with no pan/zoom. That delivered
the load-bearing properties (offline, provably-accurate pins) but its accepted limitations became
the substance of issue #76 ("the map UX is very mediocre"):

1. every chapter looked the same (always the full 10–50°E extent),
2. pins crowded into illegible clouds in dense chapters,
3. there was no detail — no zoom, and the raster blurred if scaled,
4. there was no geographic context (no named seas or regions).

ADR 0001 itself named the revisit path: *"Bundled vector (SVG) basemap … viable and crisper …
Can be revisited if infinite-zoom crispness is ever wanted,"* and listed pan/zoom as a deliberate
v1.1 deferral. #76 is when it became wanted.

The non-negotiable constraint is unchanged: songbird stays **fully offline except for Concord**
(invariants 1–3). Whatever we do must add **no runtime map service and no network round-trip**,
and must not weaken the accuracy guarantee.

## Decision

1. **Pan/zoom is pure client-side display, not a map service.** The view is a single CSS
   transform (`translate + scale`) over the bundled atlas, with a "map pane / marker pane" split:
   the basemap is transformed; pins and labels ride a separate un-scaled layer whose positions are
   computed from the same transform, so markers and text stay a constant, legible size. Each
   chapter **auto-frames to the bounding box of its own places**, so chapters look distinct. This
   is all in the browser — **zero outbound calls, offline promise intact**. (Logic:
   `frontend/src/lib/mapTransform.ts`, `cluster.ts`; shipped in PR #77.)

2. **The basemap becomes vector SVG** (`frontend/src/assets/bible-map.svg`), replacing the PNG. It
   is still rendered at **dev/build time** by `scripts/mapgen/generate_map.py` from the same
   Natural Earth public-domain vectors, projected by the **same equirectangular transform** into
   the **same bounds and `viewBox` (0 0 1000 800)** as `mapBounds.ts`/`projection.ts`. Inlined into
   the DOM, it scales as true vector — **crisp at any zoom** — where a raster `<img>` would blur.

3. **The generator clips geometry to the viewBox** (Sutherland–Hodgman for polygons,
   Cohen–Sutherland for lines, plus a small margin). Natural Earth is global; without clipping the
   SVG would carry every continent (megabytes the viewBox merely hides). Clipped, the committed
   asset is ~125 KB and **visually identical** within the extent.

4. **Curated context labels, not a gazetteer dump** (`frontend/src/lib/mapLabels.ts`). A small,
   hand-picked set of well-established seas and regions (Mediterranean Sea, Red Sea, Egypt,
   Mesopotamia, …), each at a representative in-bounds coordinate, projected with the same
   `project()`. They are **context, never a location claim** — that honesty is the pins' job. They
   render in the un-scaled layer (constant-size text) and are toggleable.

## Consequences

- **All four #76 complaints addressed** while every ADR-0001 invariant holds: offline, no runtime
  map dependency, no network call, and **pin accuracy unchanged** — `projection.ts`/`mapBounds.ts`
  and the `projection.test.ts` accuracy gate are untouched; only *display* changed.
- **The shared-transform guarantee is preserved and re-asserted for SVG.** Coastlines and pins are
  still placed by identical math, now into an identical `viewBox`. An asset test pins the contract
  (the committed SVG declares `viewBox="0 0 1000 800"`).
- **Leaner dev tooling.** The renderer no longer needs Pillow; `scripts/mapgen/requirements.txt`
  drops to just `pyshp`. (Runtime dependencies are unaffected — there were never any here.)
- **Slightly larger committed asset** (~125 KB SVG vs ~14 KB PNG), gzipped much smaller, and a
  one-time cost that buys infinite-zoom crispness and a labelable vector surface. Acceptable.

## Alternatives considered

- **Keep the PNG, add pan/zoom only** — rejected for the "no detail" complaint: a raster blurs as
  soon as you zoom in, which is exactly the interaction pan/zoom invites.
- **A tile service / map SDK (Leaflet, Mapbox, MapLibre)** — rejected again for the same reason as
  ADR 0001: it breaks the offline promise and adds a runtime dependency. Pan/zoom did **not**
  require it.
- **Labels from Natural Earth populated-places** — rejected: modern city names are off-register
  for a biblical atlas and would clutter. A curated set is honest and legible.
