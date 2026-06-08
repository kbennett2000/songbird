import { describe, expect, it } from "vitest";

import { MAP_PX } from "@/lib/mapBounds";
import {
  applyZoomAt,
  clampTransform,
  fitToBounds,
  MAX_SCALE,
  minScaleFor,
  screenPos,
} from "@/lib/mapTransform";

const CONTAINER = { width: 500, height: 400 }; // 5:4, same aspect as the atlas

describe("minScaleFor", () => {
  it("is the scale at which the whole atlas just fits the container", () => {
    expect(minScaleFor(CONTAINER)).toBeCloseTo(0.5); // 500/1000 === 400/800
  });
});

describe("fitToBounds", () => {
  it("frames the whole atlas (zoom-out floor) when there are no points", () => {
    const t = fitToBounds([], CONTAINER);
    expect(t.scale).toBeCloseTo(minScaleFor(CONTAINER));
    // Centered: a full-extent fit pins the atlas to the container origin.
    expect(t.tx).toBeCloseTo(0);
    expect(t.ty).toBeCloseTo(0);
  });

  it("frames a tight set of points more closely than the full extent", () => {
    const tight = fitToBounds(
      [
        { x: 480, y: 380 },
        { x: 520, y: 420 },
      ],
      CONTAINER,
    );
    expect(tight.scale).toBeGreaterThan(minScaleFor(CONTAINER));
  });

  it("centers the framed content in the container", () => {
    const center = { x: 500, y: 400 };
    const t = fitToBounds([center], CONTAINER);
    const pos = screenPos(center, t);
    expect(pos.x).toBeCloseTo(CONTAINER.width / 2);
    expect(pos.y).toBeCloseTo(CONTAINER.height / 2);
  });

  it("never zooms past MAX_SCALE even for a single point", () => {
    const t = fitToBounds([{ x: 500, y: 400 }], CONTAINER);
    expect(t.scale).toBeLessThanOrEqual(MAX_SCALE);
  });

  it("two different chapters' point sets produce different frames", () => {
    const judea = fitToBounds([{ x: 630, y: 330 }], CONTAINER); // ~Jerusalem
    const west = fitToBounds([{ x: 60, y: 80 }], CONTAINER); // ~Rome
    expect(judea.tx).not.toBeCloseTo(west.tx);
  });
});

describe("clampTransform", () => {
  it("clamps scale into [fit, MAX_SCALE]", () => {
    expect(clampTransform({ scale: 100, tx: 0, ty: 0 }, CONTAINER).scale).toBe(MAX_SCALE);
    expect(clampTransform({ scale: 0.001, tx: 0, ty: 0 }, CONTAINER).scale).toBeCloseTo(
      minScaleFor(CONTAINER),
    );
  });

  it("keeps the image from being panned off-screen", () => {
    const scale = 1; // image (1000x800) larger than container
    const t = clampTransform({ scale, tx: 9999, ty: 9999 }, CONTAINER);
    // tx is clamped to [container.width - scaledW, 0] === [-500, 0]
    expect(t.tx).toBeLessThanOrEqual(0);
    expect(t.tx).toBeGreaterThanOrEqual(CONTAINER.width - MAP_PX.width * scale);
  });
});

describe("clampTransform — drag pan stays on-screen (issue #76)", () => {
  it("a large drag delta cannot push the map off the viewport", () => {
    // Simulate a pan: take a zoomed-in transform, add a huge drag delta, clamp (what the drag
    // handler now does). The image must still cover the container — never slid off.
    const zoomed = { scale: 2, tx: 0, ty: 0 }; // image 2000x1600 > container
    const dragged = clampTransform(
      { ...zoomed, tx: zoomed.tx + 5000, ty: zoomed.ty - 5000 },
      CONTAINER,
    );
    const scaledW = MAP_PX.width * dragged.scale;
    const scaledH = MAP_PX.height * dragged.scale;
    expect(dragged.tx).toBeLessThanOrEqual(0);
    expect(dragged.tx).toBeGreaterThanOrEqual(CONTAINER.width - scaledW);
    expect(dragged.ty).toBeLessThanOrEqual(0);
    expect(dragged.ty).toBeGreaterThanOrEqual(CONTAINER.height - scaledH);
  });
});

describe("applyZoomAt", () => {
  it("keeps the anchored point fixed while zooming in", () => {
    const start = fitToBounds([], CONTAINER);
    const anchor = { x: 320, y: 240 };
    const before = (anchor.x - start.tx) / start.scale; // image x under the anchor
    const after = applyZoomAt(start, 2, anchor, CONTAINER);
    const imgXAfter = (anchor.x - after.tx) / after.scale;
    expect(after.scale).toBeGreaterThan(start.scale);
    expect(imgXAfter).toBeCloseTo(before, 5);
  });
});
