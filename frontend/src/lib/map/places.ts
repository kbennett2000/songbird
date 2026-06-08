import type { Feature, FeatureCollection, Point } from "geojson";

import { MAX_BOUNDS_BOX } from "@/lib/map/config";
import type { Place } from "@/schemas";

export type ConfidenceTier = "solid" | "hollow" | "disputed";

/**
 * Map a place's status/confidence to a marker tier — the honesty model, made visual (ported
 * unchanged from the previous map). Confidence is the primary signal; status only decides when
 * Concord gives no confidence value.
 */
export function tierFor(place: Place): ConfidenceTier {
  if (place.status === "disputed") return "disputed";
  if (place.confidence === "high") return "solid";
  if (place.confidence === "medium" || place.confidence === "low") return "hollow";
  return place.status === "identified" ? "solid" : "hollow";
}

/** Properties carried on each place point feature (kept small — read by the marker layer). */
export interface PlaceFeatureProps {
  id: string;
  name: string;
  status: string;
  confidence: string | null;
  tier: ConfidenceTier;
}

/**
 * Split a chapter's places into those we plot (located + within the atlas extent), those located
 * outside it ("off this map"), and those with no coordinates ("unknown" — never a fabricated pin).
 * Replaces the old `project() === null` test with a plain lng/lat box test against the tile bbox.
 */
export function partitionPlaces(places: Place[]): {
  located: Place[];
  unknown: Place[];
  offMap: Place[];
} {
  const { west, south, east, north } = MAX_BOUNDS_BOX;
  const located: Place[] = [];
  const unknown: Place[] = [];
  const offMap: Place[] = [];
  for (const p of places) {
    if (p.latitude === null || p.longitude === null) {
      unknown.push(p);
    } else if (p.longitude < west || p.longitude > east || p.latitude < south || p.latitude > north) {
      offMap.push(p);
    } else {
      located.push(p);
    }
  }
  return { located, unknown, offMap };
}

/** A located place as a GeoJSON Point feature — the input to MapLibre's clustering source. */
export function placeFeature(place: Place): Feature<Point, PlaceFeatureProps> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [place.longitude as number, place.latitude as number] },
    properties: {
      id: place.id,
      name: place.name,
      status: place.status,
      confidence: place.confidence,
      tier: tierFor(place),
    },
  };
}

/** The located places as a FeatureCollection for the `places` GeoJSON source. */
export function placesToGeoJSON(located: Place[]): FeatureCollection<Point, PlaceFeatureProps> {
  return { type: "FeatureCollection", features: located.map(placeFeature) };
}
