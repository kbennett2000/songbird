import { describe, expect, it } from "vitest";

import { MAP_LABELS } from "@/lib/map/labels";
import {
  buildClusterBadge,
  buildClusterNamesLabel,
  buildLabelElement,
  buildPlaceLabel,
} from "@/lib/map/markers";

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

  it("a place label shows the name and doesn't intercept clicks (taps reach the pin)", () => {
    const el = buildPlaceLabel("Jerusalem");
    expect(el.textContent).toBe("Jerusalem");
    expect(el.dataset.testid).toBe("map-place-label");
    expect(el.className).toContain("pointer-events-none");
  });

  it("a stuck-cluster names label stacks every member and doesn't intercept clicks (#118)", () => {
    const el = buildClusterNamesLabel(["Jerusalem", "Bethany"], 2);
    expect(el.dataset.testid).toBe("map-cluster-names");
    expect(el.className).toContain("pointer-events-none");
    expect([...el.children].map((c) => c.textContent)).toEqual(["Jerusalem", "Bethany"]);
  });

  it("a stuck-cluster names label collapses the overflow to '+N more' (#118)", () => {
    const el = buildClusterNamesLabel(["A", "B", "C", "D", "E", "F"], 6);
    // Four names spelled out, then a single "+2 more" line.
    expect([...el.children].map((c) => c.textContent)).toEqual(["A", "B", "C", "D", "+2 more"]);
  });
});
