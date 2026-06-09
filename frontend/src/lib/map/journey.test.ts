import { describe, expect, it } from "vitest";

import { stopsToRoute } from "@/lib/map/journey";
import type { JourneyStop } from "@/schemas";

function stop(overrides: Partial<JourneyStop> = {}): JourneyStop {
  return {
    ordinal: 1,
    place_id: "p",
    name: "Place",
    friendly_id: "place",
    latitude: 31.0,
    longitude: 35.0,
    confidence: "high",
    status: "identified",
    reference: "Acts 13:1",
    ...overrides,
  };
}

describe("stopsToRoute", () => {
  it("orders located stops by ordinal and emits [lng, lat] pairs", () => {
    // Fed out of order — the geometry must sort by ordinal.
    const { route, markers } = stopsToRoute([
      stop({ ordinal: 2, longitude: 36, latitude: 32 }),
      stop({ ordinal: 1, longitude: 35, latitude: 31 }),
      stop({ ordinal: 3, longitude: 37, latitude: 33 }),
    ]);
    expect(route).toEqual([
      [35, 31],
      [36, 32],
      [37, 33],
    ]);
    expect(markers.map((m) => m.ordinal)).toEqual([1, 2, 3]);
    expect(markers[0]).toEqual({ ordinal: 1, lng: 35, lat: 31 });
  });

  it("filters unlocated stops (null lat/lng) out of BOTH route and markers", () => {
    const { route, markers } = stopsToRoute([
      stop({ ordinal: 1, longitude: 35, latitude: 31 }),
      stop({ ordinal: 2, longitude: null, latitude: null }), // unlocated — dropped
      stop({ ordinal: 3, longitude: 37, latitude: 33 }),
    ]);
    expect(route).toEqual([
      [35, 31],
      [37, 33],
    ]);
    expect(markers.map((m) => m.ordinal)).toEqual([1, 3]);
  });

  it("drops a stop with only one null coordinate", () => {
    const { route, markers } = stopsToRoute([
      stop({ ordinal: 1, longitude: 35, latitude: null }),
      stop({ ordinal: 2, longitude: null, latitude: 31 }),
    ]);
    expect(route).toEqual([]);
    expect(markers).toEqual([]);
  });

  it("yields empty route + empty markers for an all-unlocated journey", () => {
    const { route, markers } = stopsToRoute([
      stop({ ordinal: 1, longitude: null, latitude: null }),
      stop({ ordinal: 2, longitude: null, latitude: null }),
    ]);
    expect(route).toEqual([]);
    expect(markers).toEqual([]);
  });
});
