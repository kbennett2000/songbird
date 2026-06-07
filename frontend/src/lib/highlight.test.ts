import { describe, expect, it } from "vitest";

import { markSegments } from "@/lib/highlight";

/** Compare on the meaningful shape (keys are just stable render ids). */
function runs(snippet: string): Array<{ text: string; mark: boolean }> {
  return markSegments(snippet).map((s) => ({ text: s.text, mark: s.mark }));
}

describe("markSegments", () => {
  it("splits a snippet into plain and marked runs", () => {
    expect(runs("rivers of <mark>living</mark> <mark>water</mark>.")).toEqual([
      { text: "rivers of ", mark: false },
      { text: "living", mark: true },
      { text: " ", mark: false },
      { text: "water", mark: true },
      { text: ".", mark: false },
    ]);
  });

  it("treats a snippet with no marks as one plain run", () => {
    expect(runs("Jesus wept.")).toEqual([{ text: "Jesus wept.", mark: false }]);
  });

  it("handles a mark at the very start", () => {
    expect(runs("<mark>Love</mark> never fails.")).toEqual([
      { text: "Love", mark: true },
      { text: " never fails.", mark: false },
    ]);
  });

  it("reconstructs the original text minus the <mark> tags", () => {
    const snippet = "a <mark>b</mark> c <mark>d</mark>";
    expect(
      markSegments(snippet)
        .map((s) => s.text)
        .join(""),
    ).toBe("a b c d");
  });

  it("gives each segment a stable, unique key", () => {
    const segs = markSegments("x <mark>y</mark> z <mark>w</mark>");
    const keys = segs.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
