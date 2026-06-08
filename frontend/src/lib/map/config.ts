import type { LngLatBoundsLike } from "maplibre-gl";

/**
 * Map constants — the single source of truth for the Map View's extent and the bundled-asset
 * paths. The extent here MUST stay in lockstep with `scripts/tilegen/build.py`'s BBOX (which
 * clipped the committed tiles); see docs/adr/0003.
 */

/** The framed world: chapters auto-fit within this (mirrors the old SVG atlas extent). */
export const BIBLE_WORLD_BOUNDS: LngLatBoundsLike = [
  [10, 13],
  [50, 45],
];

/**
 * The hard pan limit — the bbox the tiles were clipped to (a small margin beyond the world).
 * Passed to MapLibre as `maxBounds`, which is what prevents dragging the map off-screen.
 */
export const MAX_BOUNDS: LngLatBoundsLike = [
  [9, 12],
  [51, 46],
];

/** A plain-tuple form of MAX_BOUNDS for the pure in/out-of-bounds test in `places.ts`. */
export const MAX_BOUNDS_BOX = { west: 9, south: 12, east: 51, north: 46 } as const;

export const MIN_ZOOM = 3.5;
export const MAX_ZOOM = 10;
/** The relief raster's native top zoom (z8); MapLibre over-zooms it, vectors stay crisp above. */
export const RELIEF_MAXZOOM = 8;
/**
 * Cap for per-chapter auto-framing. Kept near the relief's native z8 so a tight chapter (a few
 * co-located places) opens to readable terrain with context, not an over-zoomed blur. Manual zoom
 * can still go deeper (the crisp vector coastlines/rivers reward it; the relief just softens).
 */
export const FIT_MAX_ZOOM = 9;

/** Same-origin paths to the bundled, backend-served offline assets (see scripts/tilegen). */
export const RELIEF_PMTILES_PATH = "/tiles/relief.pmtiles";
export const PHYSICAL_GEOJSON_PATH = "/tiles/bible-physical.geojson";

/** Parchment/ink palette for the crisp vector overlay drawn atop the natural-color relief. */
export const PALETTE = {
  coast: "#4a3f35",
  river: "#5d7d96",
  lake: "#5d7d96",
  reef: "#8a9a8f",
  sea: "#cfe0e6",
} as const;
