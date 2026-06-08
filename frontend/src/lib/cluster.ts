import { screenPos, type ImagePoint, type Transform } from "@/lib/mapTransform";

/**
 * A group of one or more co-located items. A cluster with a single member renders as an ordinary
 * pin; a cluster with several renders as a count badge that splits apart as you zoom in. This
 * replaces the old golden-angle spiral: instead of nudging overlapping pins into an illegible
 * cloud, we collapse them and let zoom separate them.
 *
 * `x`/`y` are the centroid in image space, so a cluster can itself be framed (tap-to-zoom).
 */
export interface Cluster<T> {
  x: number;
  y: number;
  members: T[];
}

/**
 * Greedily merge items whose *screen* positions fall within `radiusPx` of an existing cluster's
 * screen centroid. Because the test is in screen space, the same places that overlap at low zoom
 * separate into their own pins as `transform.scale` grows — no extra state, the clustering just
 * follows the zoom.
 */
export function cluster<T extends ImagePoint>(
  items: T[],
  transform: Transform,
  radiusPx: number,
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];

  for (const item of items) {
    const itemScreen = screenPos(item, transform);
    let target: Cluster<T> | null = null;
    for (const c of clusters) {
      const cScreen = screenPos(c, transform);
      const dx = cScreen.x - itemScreen.x;
      const dy = cScreen.y - itemScreen.y;
      if (Math.hypot(dx, dy) <= radiusPx) {
        target = c;
        break;
      }
    }

    if (target) {
      target.members.push(item);
      // Recompute the centroid in image space so later items test against the group's center.
      const n = target.members.length;
      target.x = target.members.reduce((s, m) => s + m.x, 0) / n;
      target.y = target.members.reduce((s, m) => s + m.y, 0) / n;
    } else {
      clusters.push({ x: item.x, y: item.y, members: [item] });
    }
  }

  return clusters;
}
