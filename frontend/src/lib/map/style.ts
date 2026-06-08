import type { FilterSpecification, StyleSpecification } from "maplibre-gl";

import {
  PALETTE,
  PHYSICAL_GEOJSON_PATH,
  RELIEF_MAXZOOM,
  RELIEF_PMTILES_PATH,
} from "@/lib/map/config";

/** A filter that matches nothing — the initial state of the selection-ring layer. */
export const MATCH_NONE: FilterSpecification = ["==", ["get", "id"], ""];

/**
 * The MapLibre style, built as a plain object (never a URL) from same-origin bundled assets, so
 * the map makes zero outbound calls (ADR 0003). `origin` is `window.location.origin` at runtime.
 *
 * Layers are **physical only** — natural-color relief raster, then crisp vector coastlines, rivers,
 * lakes, reefs, then the chapter's places as `circle` layers (clusters + points + a selection ring).
 * There are **no `symbol`/`text` layers** anywhere, so no glyph font is required; the only text
 * (cluster counts, curated labels) is drawn as DOM markers. No roads/cities/POIs/boundaries — that
 * omission is the ancient-world honesty stance.
 */
export function buildStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      relief: {
        type: "raster",
        url: `pmtiles://${origin}${RELIEF_PMTILES_PATH}`,
        tileSize: 512,
        maxzoom: RELIEF_MAXZOOM,
        attribution: "Natural Earth (public domain)",
      },
      physical: { type: "geojson", data: `${origin}${PHYSICAL_GEOJSON_PATH}` },
      places: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 14,
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": PALETTE.sea } },
      { id: "relief", type: "raster", source: "relief" },
      {
        // Inland seas/lakes (Dead Sea, Sea of Galilee) are Polygons sitting atop land-colored
        // relief, so they need a water fill or they'd read as empty outlines (issue #83). Drawn
        // under the line layers below so the `lakes` shoreline stroke still renders on top, and
        // tinted `sea` to match the open Mediterranean for one consistent water tone.
        id: "lakes-fill",
        type: "fill",
        source: "physical",
        filter: ["==", ["get", "kind"], "lake"],
        paint: { "fill-color": PALETTE.sea },
      },
      {
        id: "reefs",
        type: "line",
        source: "physical",
        filter: ["==", ["get", "kind"], "reef"],
        paint: { "line-color": PALETTE.reef, "line-width": 0.6, "line-opacity": 0.6 },
      },
      {
        id: "rivers",
        type: "line",
        source: "physical",
        filter: ["==", ["get", "kind"], "river"],
        paint: {
          "line-color": PALETTE.river,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 9, 1.4],
        },
      },
      {
        id: "lakes",
        type: "line",
        source: "physical",
        filter: ["==", ["get", "kind"], "lake"],
        paint: { "line-color": PALETTE.lake, "line-width": 0.8 },
      },
      {
        id: "coastline",
        type: "line",
        source: "physical",
        filter: ["in", ["get", "kind"], ["literal", ["coastline", "island"]]],
        paint: {
          "line-color": PALETTE.coast,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 9, 1.6],
        },
      },
      {
        id: "clusters",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#2563eb",
          "circle-stroke-color": "#1d4ed8",
          "circle-stroke-width": 2,
          "circle-radius": ["step", ["get", "point_count"], 13, 5, 16, 15, 20],
        },
      },
      {
        // Tier-colored points — the honesty model, as data-driven paint (no DOM, no glyphs).
        id: "unclustered-point",
        type: "circle",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-color": [
            "match",
            ["get", "tier"],
            "solid",
            "#2563eb",
            "disputed",
            "#ffffff",
            /* hollow */ "#ffffff",
          ],
          "circle-stroke-color": [
            "match",
            ["get", "tier"],
            "solid",
            "#1d4ed8",
            "disputed",
            "#b45309",
            /* hollow */ "#60a5fa",
          ],
        },
      },
      {
        // The selection ring — its filter is set to the selected place's id at runtime.
        id: "selected-point",
        type: "circle",
        source: "places",
        filter: MATCH_NONE,
        paint: {
          "circle-radius": 9,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#3b82f6",
          "circle-stroke-width": 3,
        },
      },
    ],
  };
}
