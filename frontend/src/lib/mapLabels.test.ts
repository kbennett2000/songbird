import { describe, expect, it } from "vitest";

import bibleMapSvg from "@/assets/bible-map.svg?raw";
import { MAP_PX } from "@/lib/mapBounds";
import { MAP_LABELS } from "@/lib/mapLabels";
import { project } from "@/lib/projection";

describe("bundled basemap asset", () => {
  it("is an SVG whose viewBox matches the shared transform's bounds", () => {
    // The load-bearing contract: the basemap and the pins share one coordinate space. If this
    // viewBox ever drifts from MAP_PX, coastlines and pins would no longer align.
    expect(bibleMapSvg).toContain(`viewBox="0 0 ${MAP_PX.width} ${MAP_PX.height}"`);
  });
});

describe("curated map labels", () => {
  it("every label is inside the atlas extent (so it actually projects)", () => {
    for (const label of MAP_LABELS) {
      expect(project(label.lat, label.lon), `${label.name} is in-bounds`).not.toBeNull();
    }
  });

  it("labels are tagged as a sea or a region", () => {
    for (const label of MAP_LABELS) {
      expect(["sea", "region"]).toContain(label.kind);
    }
  });
});
