import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Popover } from "@/components/Popover";

// happy-dom lays nothing out, so the window, the marker's place and the box's own height are given.
const VIEWPORT = { width: 400, height: 800 };
const MARGIN = 8;
const GAP = 6;

let boxHeight = 0;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: VIEWPORT.width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VIEWPORT.height });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute("role") === "dialog" ? boxHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A marker whose top edge is `top` px down the window (16 px tall), with a box `height` tall. */
function open(top: number, height: number) {
  boxHeight = height;
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () =>
    ({ top, bottom: top + 16, left: 40, right: 56, width: 16, height: 16 }) as DOMRect;
  render(
    <Popover anchor={anchor} onClose={() => {}} ariaLabel="A note">
      <p>words</p>
    </Popover>,
  );
  const box = screen.getByRole("dialog", { name: "A note" });
  return {
    top: parseFloat(box.style.top),
    maxHeight: parseFloat(box.style.maxHeight),
    below: top + 16 + GAP,
    spaceBelow: VIEWPORT.height - (top + 16) - GAP - MARGIN,
    spaceAbove: top - GAP - MARGIN,
  };
}

describe("Popover placement", () => {
  it("opens below its marker when the whole box fits there", () => {
    // Low on the screen with far more room above, but a short note still opens below, as before.
    const p = open(600, 120);
    expect(p.top).toBe(p.below);
    expect(p.maxHeight).toBe(p.spaceBelow);
  });

  it("opens above when the box doesn't fit below and there's more room above", () => {
    // 170 px below, 500-odd above: the old rule opened below into a 170 px sliver.
    const p = open(600, 520);
    expect(p.spaceBelow).toBeLessThan(520);
    expect(p.spaceAbove).toBeGreaterThan(p.spaceBelow);
    expect(p.maxHeight).toBe(p.spaceAbove);
    expect(p.top).toBe(600 - GAP - Math.min(520, p.spaceAbove));
  });

  it("opens below when the box doesn't fit either way but there's more room below", () => {
    const p = open(200, 900);
    expect(p.top).toBe(p.below);
    expect(p.maxHeight).toBe(p.spaceBelow);
  });

  it("opens below when the room on each side is the same", () => {
    // The marker's middle at the window's middle: equal room, so below, as it always was.
    const p = open(392, 900);
    expect(p.spaceBelow).toBe(p.spaceAbove);
    expect(p.top).toBe(p.below);
  });
});
