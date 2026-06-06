import { MAP_BOUNDS, MAP_PX } from "@/lib/mapBounds";

/** A point on the bundled map, in image-space pixels (0..width, 0..height). */
export interface PinPx {
  x: number;
  y: number;
}

/** A point on the bundled map, as percentages of its size — for responsive CSS placement. */
export interface PinPercent {
  leftPct: number;
  topPct: number;
}

/**
 * Project a canonical lat/lon onto the bundled equirectangular map, in image pixels.
 *
 * Equirectangular (plate carrée) makes this linear:
 *   x = (lon − west) / (east − west) × width
 *   y = (north − lat) / (north − south) × height   (y grows downward, so north maps to 0)
 *
 * Returns `null` when the point falls outside the map's bounds. That `null` is the single
 * signal the UI uses to route a located place to the "off this map" list — off-map detection
 * lives here, tested, not scattered across the component.
 */
export function project(lat: number, lon: number): PinPx | null {
  const { west, east, south, north } = MAP_BOUNDS;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const x = ((lon - west) / (east - west)) * MAP_PX.width;
  const y = ((north - lat) / (north - south)) * MAP_PX.height;
  return { x, y };
}

/**
 * Like `project`, but as percentages of the image size — the form the map component uses to
 * place pins responsively (the image scales with its container; percentages track it with no
 * resize math). `null` for off-map points, same as `project`.
 */
export function projectPercent(lat: number, lon: number): PinPercent | null {
  const px = project(lat, lon);
  if (px === null) return null;
  return {
    leftPct: (px.x / MAP_PX.width) * 100,
    topPct: (px.y / MAP_PX.height) * 100,
  };
}
