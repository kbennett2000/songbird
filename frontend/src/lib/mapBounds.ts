/**
 * The bundled Bible-world atlas: its exact geographic bounds and pixel size.
 *
 * This is the SINGLE SOURCE OF TRUTH shared by two consumers that must never drift:
 *   1. the runtime pin math in `projection.ts` (lat/lon → x/y on the image), and
 *   2. the dev-only basemap renderer `scripts/mapgen/generate_map.py`.
 *
 * The projection is **equirectangular (plate carrée)**, which makes the lat/lon → pixel
 * transform purely linear (see `projection.ts`). That linearity is only correct because the
 * basemap was rendered into *exactly* these bounds at *exactly* this pixel size.
 *
 * ⚠ If you change any value here, you MUST re-run `scripts/mapgen/generate_map.py` to
 * re-render `assets/bible-map.png` against the new bounds — otherwise pins will be
 * confidently wrong (worse than no map). The accuracy test (`projection.test.ts`) recomputes
 * its expectations from these constants, so it will follow a change here automatically.
 *
 * Extent: chosen to comfortably contain the places Concord locates across the biblical world —
 * Rome, the Nile delta, Mesopotamia/Babylon, Ararat, Cush. Places located outside this box
 * (e.g. Tarshish in Iberia) are intentionally surfaced as "off this map", never clipped.
 */

/** Exact geographic bounds of the bundled map (degrees). */
export const MAP_BOUNDS = {
  west: 10,
  east: 50,
  south: 13,
  north: 45,
} as const;

/** Pixel dimensions the basemap was rendered at. 5:4, 25 px/degree on both axes (undistorted). */
export const MAP_PX = {
  width: 1000,
  height: 800,
} as const;
