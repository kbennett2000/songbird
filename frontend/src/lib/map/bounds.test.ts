import { describe, expect, it } from "vitest";

import { boundsForPlaces } from "@/lib/map/bounds";
import type { Place } from "@/schemas";

function at(id: string, lon: number, lat: number): Place {
  return {
    id,
    friendly_id: id,
    name: id,
    type: "settlement",
    latitude: lat,
    longitude: lon,
    confidence: "high",
    confidence_score: 90,
    status: "identified",
  };
}

describe("boundsForPlaces", () => {
  it("returns null when there are no located places", () => {
    expect(boundsForPlaces([])).toBeNull();
  });

  it("returns the tight [[w,s],[e,n]] box of the places", () => {
    const b = boundsForPlaces([at("a", 12.5, 41.9), at("b", 35.2, 31.8)]);
    expect(b).toEqual([
      [12.5, 31.8],
      [35.2, 41.9],
    ]);
  });

  it("gives a single place a zero-area box (fitBounds + maxZoom tames it)", () => {
    const b = boundsForPlaces([at("a", 35.2, 31.8)]);
    expect(b).toEqual([
      [35.2, 31.8],
      [35.2, 31.8],
    ]);
  });
});
