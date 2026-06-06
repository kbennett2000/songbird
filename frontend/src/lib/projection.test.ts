import { describe, expect, it } from "vitest";

import { MAP_BOUNDS, MAP_PX } from "@/lib/mapBounds";
import { project, projectPercent } from "@/lib/projection";

/**
 * The accuracy gate for the map feature (its canonical-coordinate-bridge equivalent).
 *
 * A pin in the wrong place is *confidently wrong* — worse than no map. So we plot known
 * landmarks at known coordinates and assert each lands at the correct pixel within tolerance.
 * The expected pixel is computed here straight from the equirectangular formula against the
 * documented bounds, independently of `projection.ts`'s implementation — so this test pins the
 * contract, not the code.
 */

const { west, east, south, north } = MAP_BOUNDS;
const { width, height } = MAP_PX;

/** Independent reimplementation of the equirectangular transform — the contract, not the code. */
function expected(lat: number, lon: number): { x: number; y: number } {
  return {
    x: ((lon - west) / (east - west)) * width,
    y: ((north - lat) / (north - south)) * height,
  };
}

const TOLERANCE_PX = 2;

describe("project — landmark accuracy", () => {
  const landmarks: Array<{ name: string; lat: number; lon: number }> = [
    { name: "Jerusalem", lat: 31.78, lon: 35.23 },
    { name: "Rome", lat: 41.9, lon: 12.5 },
    { name: "Babylon", lat: 32.5, lon: 44.4 },
    { name: "Nile delta", lat: 31.2, lon: 31.1 },
    { name: "Mt. Ararat", lat: 39.7, lon: 44.3 },
  ];

  for (const { name, lat, lon } of landmarks) {
    it(`places ${name} at the correct pixel`, () => {
      const px = project(lat, lon);
      const want = expected(lat, lon);
      expect(px).not.toBeNull();
      expect(px!.x).toBeCloseTo(want.x, 0);
      expect(px!.y).toBeCloseTo(want.y, 0);
      expect(Math.abs(px!.x - want.x)).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(Math.abs(px!.y - want.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});

describe("project — off-map coordinates", () => {
  it("returns null for Tarshish (Iberia, west of the map)", () => {
    expect(project(36.7, -6.0)).toBeNull();
  });

  it("returns null for a point east of the map", () => {
    expect(project(32, east + 5)).toBeNull();
  });

  it("returns null for a point south of the map", () => {
    expect(project(south - 5, 35)).toBeNull();
  });

  it("returns null for a point north of the map", () => {
    expect(project(north + 5, 35)).toBeNull();
  });
});

describe("project — exact corners", () => {
  it("maps the NW corner to (0, 0)", () => {
    expect(project(north, west)).toEqual({ x: 0, y: 0 });
  });

  it("maps the SE corner to (width, height)", () => {
    expect(project(south, east)).toEqual({ x: width, y: height });
  });

  it("maps the map center to its pixel center", () => {
    const px = project((north + south) / 2, (west + east) / 2);
    expect(px).toEqual({ x: width / 2, y: height / 2 });
  });
});

describe("projectPercent", () => {
  it("expresses a pixel as a percentage of the image size", () => {
    expect(projectPercent(north, west)).toEqual({ leftPct: 0, topPct: 0 });
    expect(projectPercent(south, east)).toEqual({ leftPct: 100, topPct: 100 });
  });

  it("returns null for off-map points", () => {
    expect(projectPercent(36.7, -6.0)).toBeNull();
  });
});
