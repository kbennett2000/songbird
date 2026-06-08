import { describe, expect, it } from "vitest";

import { partitionPlaces, placeFeature, placesToGeoJSON, tierFor } from "@/lib/map/places";
import type { Place } from "@/schemas";

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: "x",
    friendly_id: "x",
    name: "Place",
    type: "settlement",
    latitude: 31.78,
    longitude: 35.23,
    confidence: "high",
    confidence_score: 90,
    status: "identified",
    ...overrides,
  };
}

describe("tierFor", () => {
  it("encodes confidence/status as a marker tier", () => {
    expect(tierFor(place({ confidence: "high" }))).toBe("solid");
    expect(tierFor(place({ confidence: "medium" }))).toBe("hollow");
    expect(tierFor(place({ confidence: "low" }))).toBe("hollow");
    expect(tierFor(place({ status: "disputed", confidence: "high" }))).toBe("disputed");
    expect(tierFor(place({ confidence: null, status: "identified" }))).toBe("solid");
    expect(tierFor(place({ confidence: null, status: "unknown" }))).toBe("hollow");
  });
});

describe("partitionPlaces", () => {
  it("routes by coordinates: located in-bounds / off-map / unknown", () => {
    const jerusalem = place({ id: "jeru", latitude: 31.78, longitude: 35.23 });
    const tarshish = place({ id: "tar", latitude: 36.7, longitude: -6.0 }); // Iberia, off-map west
    const eden = place({ id: "eden", latitude: null, longitude: null });
    const { located, offMap, unknown } = partitionPlaces([jerusalem, tarshish, eden]);
    expect(located.map((p) => p.id)).toEqual(["jeru"]);
    expect(offMap.map((p) => p.id)).toEqual(["tar"]);
    expect(unknown.map((p) => p.id)).toEqual(["eden"]);
  });
});

describe("placeFeature / placesToGeoJSON", () => {
  it("builds a Point feature with [lon, lat] and the tier in properties", () => {
    const f = placeFeature(place({ id: "jeru", latitude: 31.78, longitude: 35.23 }));
    expect(f.geometry.coordinates).toEqual([35.23, 31.78]);
    expect(f.properties.tier).toBe("solid");
    expect(f.properties.id).toBe("jeru");
  });

  it("wraps located places into a FeatureCollection", () => {
    const fc = placesToGeoJSON([place({ id: "a" }), place({ id: "b" })]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
  });
});
