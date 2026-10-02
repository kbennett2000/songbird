/**
 * The arithmetic behind the chart viewer's zoom (components/ChartViewer.tsx), kept pure so it can
 * be tested without a browser.
 *
 * A scale is CSS pixels per picture pixel: 1 is the picture's own size. The picture sits in a
 * scroll box and is centred while it's smaller than the box (its margins absorb the difference),
 * so along each axis its left (or top) edge is at `imageOffset` in the box's scrolled content.
 * Zooming keeps one point of the picture — under the fingers, the pointer, or the box's centre —
 * at the same place on screen: find which picture pixel is there (`pointUnder`), then the scroll
 * position that puts it back (`scrollToKeep`).
 */

/** The largest zoom: three times the picture's own pixels. */
export const MAX_SCALE = 3;

/** Each press of + or − multiplies or divides the scale by this. */
export const ZOOM_STEP = 1.5;

export interface Size {
  width: number;
  height: number;
}

/** The scale that shows the whole picture in the box — never enlarged past its own size. */
export function fitScale(natural: Size, box: Size): number {
  if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return 1;
  return Math.min(1, box.width / natural.width, box.height / natural.height);
}

/** A scale held between fitting the box and {@link MAX_SCALE}. */
export function clampScale(scale: number, fit: number): number {
  return Math.min(Math.max(scale, fit), Math.max(fit, MAX_SCALE));
}

/** Where the picture's edge sits along one axis: centred while it's smaller than the box. */
export function imageOffset(boxLength: number, naturalLength: number, scale: number): number {
  return Math.max(0, (boxLength - naturalLength * scale) / 2);
}

/** Which picture pixel (along one axis) is under `focal`, a point in the box's visible area. */
export function pointUnder(
  scroll: number,
  focal: number,
  boxLength: number,
  naturalLength: number,
  scale: number,
): number {
  return (scroll + focal - imageOffset(boxLength, naturalLength, scale)) / scale;
}

/** The scroll position (along one axis) that puts picture pixel `point` back under `focal`. */
export function scrollToKeep(
  point: number,
  focal: number,
  boxLength: number,
  naturalLength: number,
  scale: number,
): number {
  return Math.max(0, point * scale + imageOffset(boxLength, naturalLength, scale) - focal);
}

/** What a double-tap goes to from the fitted view: the picture's own size, or twice it when the
 * whole picture already fits at its own size. */
export function doubleTapScale(fit: number): number {
  return fit < 1 ? 1 : Math.min(2, MAX_SCALE);
}
