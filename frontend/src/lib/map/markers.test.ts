import { describe, expect, it } from "vitest";

import { MAP_LABELS } from "@/lib/map/labels";
import { buildClusterBadge, buildLabelElement } from "@/lib/map/markers";

describe("map labels (curated)", () => {
  it("are all within the atlas extent (so they actually place)", () => {
    for (const l of MAP_LABELS) {
      expect(l.lon, l.name).toBeGreaterThanOrEqual(9);
      expect(l.lon, l.name).toBeLessThanOrEqual(51);
      expect(l.lat, l.name).toBeGreaterThanOrEqual(12);
      expect(l.lat, l.name).toBeLessThanOrEqual(46);
    }
  });

  it("cover seas, regions, rivers, mountains, and deserts", () => {
    const kinds = new Set(MAP_LABELS.map((l) => l.kind));
    expect([...kinds].sort()).toEqual(["desert", "mountain", "region", "river", "sea"]);
  });
});

describe("marker DOM builders", () => {
  it("a cluster badge shows the count and doesn't intercept clicks", () => {
    const el = buildClusterBadge(7);
    expect(el.textContent).toBe("7");
    expect(el.dataset.testid).toBe("map-cluster");
    expect(el.className).toContain("pointer-events-none");
  });

  it("a label element carries its name and kind", () => {
    const el = buildLabelElement("Mediterranean Sea", "sea");
    expect(el.textContent).toBe("Mediterranean Sea");
    expect(el.dataset.kind).toBe("sea");
    expect(el.dataset.testid).toBe("map-label");
  });
});
