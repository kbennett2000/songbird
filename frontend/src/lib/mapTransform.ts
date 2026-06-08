import { MAP_PX } from "@/lib/mapBounds";

/**
 * The display transform for the map: how image-space pixels (0..MAP_PX) map to on-screen
 * pixels inside the map container. Pin accuracy lives in `projection.ts` (lat/lon → image px)
 * and is never touched here — this module only *displays* those already-correct points, so
 * pan/zoom can never make a pin "confidently wrong".
 *
 *   screenX = imageX · scale + tx
 *   screenY = imageY · scale + ty
 */
export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

/** A size in CSS pixels (the on-screen map container). */
export interface Size {
  width: number;
  height: number;
}

/** A point in image space (0..MAP_PX.width, 0..MAP_PX.height) — what `project()` returns. */
export interface ImagePoint {
  x: number;
  y: number;
}

/** Hard zoom-in ceiling (relative to the full-extent fit, which is the zoom-out floor). */
export const MAX_SCALE = 8;

/** Padding kept between the framed content and the container edge, in screen px. */
const FIT_PADDING = 24;

/**
 * Smallest span (image px) a frame is allowed to have, so a single place or a tight cluster
 * doesn't zoom to an absurd level. ~120 px ≈ 5° on the bundled atlas (25 px/degree).
 */
const MIN_SPAN = 120;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The zoom-out floor: the scale at which the whole atlas just fits the container. The container
 * is 5:4 and so is the image, so this is exact; we never let the user zoom out past it (no point
 * showing dead space around a fixed-extent map).
 */
export function minScaleFor(container: Size): number {
  if (container.width <= 0 || container.height <= 0) return 1;
  return Math.min(container.width / MAP_PX.width, container.height / MAP_PX.height);
}

/**
 * Keep a transform valid: clamp scale to [fit, MAX_SCALE] and keep the image from being panned
 * away from the viewport. When the scaled image is smaller than the container on an axis it's
 * centered on that axis; otherwise its edges are pinned to the container edges.
 */
export function clampTransform(t: Transform, container: Size): Transform {
  const scale = clamp(t.scale, minScaleFor(container), MAX_SCALE);
  const scaledW = MAP_PX.width * scale;
  const scaledH = MAP_PX.height * scale;

  const tx =
    scaledW <= container.width
      ? (container.width - scaledW) / 2
      : clamp(t.tx, container.width - scaledW, 0);
  const ty =
    scaledH <= container.height
      ? (container.height - scaledH) / 2
      : clamp(t.ty, container.height - scaledH, 0);

  return { scale, tx, ty };
}

/** Where an image-space point lands on screen, under the given transform. */
export function screenPos(point: ImagePoint, t: Transform): { x: number; y: number } {
  return { x: point.x * t.scale + t.tx, y: point.y * t.scale + t.ty };
}

/**
 * Compute the transform that frames `points` within the container. With no points it frames the
 * whole atlas (the zoom-out floor). This is the fix for "all maps look the same": each chapter
 * frames the bounding box of *its own* places, so a Judea-only chapter and a Mediterranean
 * chapter open to visibly different views.
 */
export function fitToBounds(
  points: ImagePoint[],
  container: Size,
  padding: number = FIT_PADDING,
): Transform {
  let minX: number;
  let minY: number;
  let maxX: number;
  let maxY: number;

  if (points.length === 0) {
    minX = 0;
    minY = 0;
    maxX = MAP_PX.width;
    maxY = MAP_PX.height;
  } else {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  // Enforce a minimum span so a point/tight cluster doesn't over-zoom.
  let spanX = maxX - minX;
  let spanY = maxY - minY;
  if (spanX < MIN_SPAN) {
    const cx = (minX + maxX) / 2;
    minX = cx - MIN_SPAN / 2;
    maxX = cx + MIN_SPAN / 2;
    spanX = MIN_SPAN;
  }
  if (spanY < MIN_SPAN) {
    const cy = (minY + maxY) / 2;
    minY = cy - MIN_SPAN / 2;
    maxY = cy + MIN_SPAN / 2;
    spanY = MIN_SPAN;
  }

  const availW = Math.max(1, container.width - 2 * padding);
  const availH = Math.max(1, container.height - 2 * padding);
  const scale = clamp(Math.min(availW / spanX, availH / spanY), minScaleFor(container), MAX_SCALE);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return clampTransform(
    { scale, tx: container.width / 2 - cx * scale, ty: container.height / 2 - cy * scale },
    container,
  );
}

/**
 * Zoom by `factor` while keeping the image point currently under `anchor` (a screen-space point,
 * e.g. the cursor or a pinch midpoint) pinned in place — the natural "zoom toward the cursor".
 */
export function applyZoomAt(
  t: Transform,
  factor: number,
  anchor: { x: number; y: number },
  container: Size,
): Transform {
  const nextScale = clamp(t.scale * factor, minScaleFor(container), MAX_SCALE);
  // The image point under the anchor must stay under the anchor after zooming.
  const imgX = (anchor.x - t.tx) / t.scale;
  const imgY = (anchor.y - t.ty) / t.scale;
  return clampTransform(
    { scale: nextScale, tx: anchor.x - imgX * nextScale, ty: anchor.y - imgY * nextScale },
    container,
  );
}
