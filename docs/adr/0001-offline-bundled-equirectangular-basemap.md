# ADR 0001 — Offline bundled equirectangular basemap for the Map View

- **Status:** Accepted
- **Date:** 2026-06-06
- **Context:** songbird v1.1 Map View (`docs/v1.1/MAP-SPEC.md`)

## Context

The v1.1 Map View plots the located places of a chapter (lat/lon, from Concord) onto a map in the
reader. songbird's whole stack is designed to run **offline except for Concord** (the README
promises it works without an internet connection; Concord can run `--network none`). A map feature
must not break that promise, and it must not "confidently" misplace a pin — a pin in the wrong
place is worse than no map.

Two forces pull against each other: maps usually mean a tile service (Leaflet+OSM, Mapbox, Google),
and accurate pin placement usually means a projection library. Both would add a third-party runtime
dependency — exactly what this project has consistently refused — and the tile service would also
add a network round-trip at runtime.

## Decision

1. **No runtime map service.** The map is a **single static image asset bundled into songbird** and
   plotted onto with songbird's own code. Zero outbound calls at runtime.
2. **Equirectangular (plate carrée) projection with exact, documented bounds.** This makes the
   lat/lon → pixel transform purely linear:
   `x = (lon − west)/(east − west) × W`, `y = (north − lat)/(north − south) × H`.
   The bounds and pixel size are a single source of truth: `frontend/src/lib/mapBounds.ts`
   (west 10°E, east 50°E, south 13°N, north 45°N; 1000×800).
3. **The basemap is rendered from Natural Earth public-domain vectors** by a **dev/build-time
   script** (`scripts/mapgen/generate_map.py`, using `pyshp` + `Pillow`), and the **resulting PNG
   is committed** (`frontend/src/assets/bible-map.png`). The script's dependencies are **not** in
   songbird's runtime requirements.
4. **The renderer and the runtime share the identical transform.** The script projects coastlines
   with the same equation, into the same bounds and size, that `frontend/src/lib/projection.ts`
   uses for pins. So coastlines and pins are placed by identical math and cannot drift.
5. **A pixel-accuracy test gates the feature** (`frontend/src/lib/projection.test.ts`): known
   landmarks at known coordinates must land at the correct pixel within tolerance, and out-of-bounds
   coordinates must return `null` (the signal for the "off this map" list).

## Consequences

- **Offline promise intact.** No tile server, no map SDK, no runtime third-party dependency. The
  one network step (downloading Natural Earth source vectors) happens only when a maintainer
  regenerates the asset, never in songbird's runtime or CI.
- **Lean runtime.** songbird ships a ~14 KB PNG. The geo tooling (`pyshp`, `Pillow`) is confined to
  `scripts/mapgen/requirements.txt`, honoring the "no heavy geo/ML stack in songbird" discipline
  (the heavy ML already lives in Concord; the same principle here).
- **Licensing is clean.** Natural Earth is public domain.
- **Accuracy is provable, not hoped-for.** Because the basemap is rendered with the same transform
  the pins use, and that transform is unit-tested against real landmarks, "confidently wrong"
  placement is structurally prevented.
- **Accepted limitations (deferred, per spec §9):** fixed-fit view — no pan/zoom in v1.1; a fixed
  extent means places outside it (e.g. Tarshish) are *listed* as off-map rather than shown; raster
  (not vector) means no infinite-zoom crispness. All acceptable for v1.1.

## Alternatives considered

- **Leaflet + OpenStreetMap / Mapbox tiles** — rejected: breaks offline, adds a runtime service
  dependency.
- **Bundled vector (SVG) basemap rendered at build time** — viable and crisper, but a committed PNG
  is leaner and simpler, and pin accuracy does not depend on the format (it depends on the bounds +
  shared transform). Can be revisited if infinite-zoom crispness is ever wanted.
- **A projection library at runtime (e.g. proj4)** — unnecessary: equirectangular is two lines of
  arithmetic; a dependency would be all cost, no benefit.
