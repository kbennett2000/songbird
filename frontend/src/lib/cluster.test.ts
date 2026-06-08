import { describe, expect, it } from "vitest";

import { cluster } from "@/lib/cluster";
import { fitToBounds, type Transform } from "@/lib/mapTransform";

const CONTAINER = { width: 500, height: 400 };
const RADIUS = 28;

// Two places ~20 image px apart (≈ 0.8°). They overlap at the zoomed-out fit and separate as we zoom.
const A = { id: "a", x: 600, y: 330 };
const B = { id: "b", x: 620, y: 332 };
const FAR = { id: "far", x: 100, y: 100 };

describe("cluster", () => {
  it("merges near points into one cluster at low zoom", () => {
    const fit = fitToBounds([A, B, FAR], CONTAINER);
    const out = cluster([A, B, FAR], fit, RADIUS);
    const sizes = out.map((c) => c.members.length).sort();
    expect(sizes).toEqual([1, 2]); // {A,B} merged, FAR alone
  });

  it("splits a cluster apart as the scale increases", () => {
    const zoomedIn: Transform = { scale: 6, tx: 0, ty: 0 };
    const out = cluster([A, B], zoomedIn, RADIUS);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.members.length === 1)).toBe(true);
  });

  it("keeps a single point as a one-member cluster", () => {
    const out = cluster([A], fitToBounds([A], CONTAINER), RADIUS);
    expect(out).toHaveLength(1);
    expect(out[0]!.members).toEqual([A]);
  });

  it("places a cluster's centroid between its members", () => {
    const out = cluster([A, B], { scale: 0.5, tx: 0, ty: 0 }, RADIUS);
    expect(out).toHaveLength(1);
    expect(out[0]!.x).toBeCloseTo((A.x + B.x) / 2);
    expect(out[0]!.y).toBeCloseTo((A.y + B.y) / 2);
  });
});
