/**
 * Curated geographic context labels for the atlas — named seas, regions, rivers, mountains, and
 * deserts of the biblical world. Hand-picked, not a gazetteer dump: only well-established names,
 * each at a representative in-bounds point. They are *context, never a location claim* — that
 * honesty is the pins' job (ADR 0002/0003). Rendered as DOM markers (no font glyphs needed).
 */
export type LabelKind = "sea" | "region" | "river" | "mountain" | "desert";

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
  // Rivers
  { name: "Nile", lat: 27.0, lon: 31.2, kind: "river" },
  { name: "Jordan", lat: 32.3, lon: 35.55, kind: "river" },
  { name: "Euphrates", lat: 35.0, lon: 40.0, kind: "river" },
  { name: "Tigris", lat: 34.5, lon: 43.5, kind: "river" },
  // Mountains
  { name: "Mt. Sinai", lat: 28.5, lon: 33.97, kind: "mountain" },
  { name: "Mt. Ararat", lat: 39.7, lon: 44.3, kind: "mountain" },
  { name: "Mt. Lebanon", lat: 34.0, lon: 36.0, kind: "mountain" },
  // Deserts
  { name: "Negev", lat: 30.6, lon: 34.8, kind: "desert" },
  { name: "Arabian Desert", lat: 24.0, lon: 45.0, kind: "desert" },
  // Regions
  { name: "Egypt", lat: 27.5, lon: 29.5, kind: "region" },
  { name: "Mesopotamia", lat: 34.5, lon: 42.0, kind: "region" },
  { name: "Asia Minor", lat: 39.0, lon: 33.0, kind: "region" },
  { name: "Greece", lat: 39.5, lon: 22.0, kind: "region" },
];
