import { describe, expect, it } from "vitest";

import {
  MAX_SCALE,
  clampScale,
  doubleTapScale,
  fitScale,
  imageOffset,
  pointUnder,
  scrollToKeep,
} from "@/lib/chartZoom";

describe("chartZoom", () => {
  it("fits a big picture to the box, by its tighter side", () => {
    // 1000×500 in a 400×400 box: the width binds.
    expect(fitScale({ width: 1000, height: 500 }, { width: 400, height: 400 })).toBe(0.4);
    // 500×1000 in the same box: the height binds.
    expect(fitScale({ width: 500, height: 1000 }, { width: 400, height: 400 })).toBe(0.4);
  });

  it("never enlarges a picture that already fits", () => {
    expect(fitScale({ width: 300, height: 200 }, { width: 1200, height: 800 })).toBe(1);
  });

  it("treats an unknown size as the picture's own size", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
  });

  it("holds a scale between fitting and three times the picture's size", () => {
    expect(clampScale(0.1, 0.4)).toBe(0.4);
    expect(clampScale(1.5, 0.4)).toBe(1.5);
    expect(clampScale(9, 0.4)).toBe(MAX_SCALE);
  });

  it("centres a picture smaller than the box, and pins a bigger one to the edge", () => {
    expect(imageOffset(400, 1000, 0.2)).toBe(100); // 200 wide in 400: 100 either side
    expect(imageOffset(400, 1000, 1)).toBe(0);
  });

  it("keeps the point under the fingers in place as the scale changes", () => {
    // Fitted (0.4): a 1000-px picture is 400 wide, no scroll. The finger is at 100 → pixel 250.
    const point = pointUnder(0, 100, 400, 1000, 0.4);
    expect(point).toBe(250);
    // At its own size, pixel 250 is at 250 in the content; to sit under the finger, scroll 150.
    expect(scrollToKeep(point, 100, 400, 1000, 1)).toBe(150);
    // And it reads back: at that scroll, the finger is over pixel 250 again.
    expect(pointUnder(150, 100, 400, 1000, 1)).toBe(250);
  });

  it("accounts for the margin of a centred picture", () => {
    // 1000 px at 0.2 is 200 wide, centred in 400 (offset 100). The box's centre (200) is pixel 500.
    expect(pointUnder(0, 200, 400, 1000, 0.2)).toBe(500);
    // At 1× pixel 500 sits at 500; under the centre means scrolling 300.
    expect(scrollToKeep(500, 200, 400, 1000, 1)).toBe(300);
  });

  it("never asks for a negative scroll", () => {
    expect(scrollToKeep(0, 200, 400, 1000, 1)).toBe(0);
  });

  it("double-taps to the picture's own size, or twice it when that already fits", () => {
    expect(doubleTapScale(0.38)).toBe(1);
    expect(doubleTapScale(1)).toBe(2);
  });
});
