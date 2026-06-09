import type { JourneyStop } from "@/schemas";

/** A numbered marker for a located stop — the ordinal drawn on the map at its coordinates. */
export interface JourneyMarker {
  ordinal: number;
  lng: number;
  lat: number;
}

/** The drawable geometry of a journey: the route polyline + the numbered markers. */
export interface JourneyGeometry {
  route: [number, number][];
  markers: JourneyMarker[];
}

/**
 * Turn a journey's stops into drawable route geometry — the honesty filtering lives here (kept pure
 * so the MapLibre glue stays thin and this is what's unit-tested). Unlocated stops (null lat/lng)
 * are dropped from BOTH the route line and the markers (never a guessed pin); the rest are ordered
 * by `ordinal` and emitted as `[lng, lat]` pairs. An all-unlocated journey yields empty arrays.
 */
export function stopsToRoute(stops: JourneyStop[]): JourneyGeometry {
  const located = stops
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .sort((a, b) => a.ordinal - b.ordinal);
  return {
    route: located.map((s) => [s.longitude as number, s.latitude as number]),
    markers: located.map((s) => ({
      ordinal: s.ordinal,
      lng: s.longitude as number,
      lat: s.latitude as number,
    })),
  };
}
