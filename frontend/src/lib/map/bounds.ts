import type { LngLatBoundsLike } from "maplibre-gl";

import type { Place } from "@/schemas";

/**
 * The bounding box of a chapter's located places, for `map.fitBounds` — the per-chapter
 * auto-framing that makes a Judea chapter and a Mediterranean chapter open to different views.
 * Returns `null` when there's nothing to frame (caller falls back to BIBLE_WORLD_BOUNDS).
 *
 * A single place yields a zero-area box; MapLibre's `fitBounds` with `maxZoom` keeps that from
 * zooming to absurdity, so no special-casing is needed here.
 */
export function boundsForPlaces(located: Place[]): LngLatBoundsLike | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of located) {
    if (p.longitude === null || p.latitude === null) continue;
    west = Math.min(west, p.longitude);
    east = Math.max(east, p.longitude);
    south = Math.min(south, p.latitude);
    north = Math.max(north, p.latitude);
  }
  if (!Number.isFinite(west)) return null;
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * The bounding box of a set of `[lng, lat]` coordinates, for `map.fitBounds` — the journey-route
 * companion to `boundsForPlaces` (which is `Place`-typed). Returns `null` when empty (caller falls
 * back to BIBLE_WORLD_BOUNDS).
 */
export function boundsForCoords(coords: [number, number][]): LngLatBoundsLike | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of coords) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return null;
  return [
    [west, south],
    [east, north],
  ];
}
