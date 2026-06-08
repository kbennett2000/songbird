import { describe, expect, it } from "vitest";

import { buildStyle } from "@/lib/map/style";

const style = buildStyle("http://localhost");
const layerIds = style.layers.map((l) => l.id);
const layerTypes = new Set(style.layers.map((l) => l.type));

describe("buildStyle — offline + physical-only contract", () => {
  it("reads relief + physical from same-origin bundled assets via pmtiles/geojson", () => {
    const relief = style.sources.relief as { type: string; url?: string };
    const physical = style.sources.physical as { type: string; data?: string };
    expect(relief.type).toBe("raster");
    expect(relief.url).toBe("pmtiles://http://localhost/tiles/relief.pmtiles");
    expect(physical.type).toBe("geojson");
    expect(physical.data).toBe("http://localhost/tiles/bible-physical.geojson");
  });

  it("clusters the places source", () => {
    const places = style.sources.places as { type: string; cluster?: boolean };
    expect(places.type).toBe("geojson");
    expect(places.cluster).toBe(true);
  });

  it("has no glyph font dependency (all text is DOM markers) — keeps the map offline", () => {
    expect(style.glyphs).toBeUndefined();
    // and no symbol/text layers that would require glyphs
    expect(layerTypes.has("symbol")).toBe(false);
  });

  it("is physical-only: only relief + physical + place layers, nothing modern (honesty)", () => {
    const allowed = new Set([
      "bg",
      "relief",
      "lakes-fill",
      "reefs",
      "rivers",
      "lakes",
      "coastline",
      "clusters",
      "unclustered-point",
      "selected-point",
    ]);
    // No road/city/POI/boundary layer can sneak in — the whitelist is the contract.
    expect(layerIds.filter((id) => !allowed.has(id))).toEqual([]);
  });

  it("draws the place layers needed for tiers, clusters, and the selection ring", () => {
    expect(layerIds).toEqual(
      expect.arrayContaining(["relief", "coastline", "rivers", "clusters", "unclustered-point", "selected-point"]),
    );
  });

  it("fills inland seas/lakes, not just their outline (issue #83)", () => {
    const fill = style.layers.find(
      (l) => l.type === "fill" && JSON.stringify(l.filter).includes('"lake"'),
    );
    expect(fill).toBeDefined();
    // The shoreline outline still renders on top of the fill.
    expect(layerIds).toContain("lakes");
  });

  it("colors unclustered points by tier (the honesty model, data-driven)", () => {
    const pts = style.layers.find((l) => l.id === "unclustered-point");
    expect(JSON.stringify(pts)).toContain("tier");
  });
});
