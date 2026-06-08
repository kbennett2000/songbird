/**
 * A small, curated set of geographic context labels for the bundled atlas — the named seas and
 * regions of the biblical world. These are deliberately *hand-picked*, not pulled from a modern
 * gazetteer: only well-established names that orient the reader, placed at a representative point
 * within the atlas extent. They are context, never a claim about a specific place's location —
 * that honesty is what the pins (from Concord, with confidence) are for.
 *
 * Coordinates are canonical lat/lon and are projected with the same `project()` the pins use, so
 * a label sits exactly where the geography says it should. Every entry is inside the atlas bounds
 * (10–50°E, 13–45°N); a label whose coordinate fell outside would simply not be projected.
 */
export type LabelKind = "sea" | "region";

export interface MapLabel {
  name: string;
  lat: number;
  lon: number;
  kind: LabelKind;
}

export const MAP_LABELS: readonly MapLabel[] = [
  // Waters
  { name: "Mediterranean Sea", lat: 34.0, lon: 18.0, kind: "sea" },
  { name: "Red Sea", lat: 22.0, lon: 37.5, kind: "sea" },
  { name: "Persian Gulf", lat: 27.5, lon: 49.5, kind: "sea" },
  { name: "Sea of Galilee", lat: 32.8, lon: 35.6, kind: "sea" },
  { name: "Dead Sea", lat: 31.3, lon: 35.5, kind: "sea" },
  // Regions
  { name: "Egypt", lat: 27.5, lon: 29.5, kind: "region" },
  { name: "Arabia", lat: 24.0, lon: 44.0, kind: "region" },
  { name: "Mesopotamia", lat: 34.5, lon: 42.5, kind: "region" },
  { name: "Asia Minor", lat: 39.0, lon: 33.0, kind: "region" },
  { name: "Greece", lat: 39.5, lon: 22.0, kind: "region" },
];
