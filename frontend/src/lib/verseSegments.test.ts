import { describe, expect, it } from "vitest";

import { type VerseSegment, verseSegments } from "@/lib/verseSegments";
import type { TranslatorNote } from "@/schemas";

// NET John 3:16-ish text — English/Latin (BMP), so JS indices match Concord's codepoint offsets.
const VERSE = "For this is the way God loved the world: he gave his one and only Son";

function note(overrides: Partial<TranslatorNote> = {}): TranslatorNote {
  return {
    book: "JHN",
    chapter: 3,
    verse: 16,
    reference: "John 3:16",
    type: "tn",
    text: "a note",
    char_offset: 0,
    marker: null,
    ordinal: 1,
    cross_references: [],
    ...overrides,
  };
}

/** The alignment guard: text segments always reconstruct the original verse string exactly. */
function textOf(segments: VerseSegment[]): string {
  return segments
    .filter((s): s is Extract<VerseSegment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("");
}

describe("verseSegments", () => {
  it("returns a single text run when there are no notes", () => {
    expect(verseSegments(VERSE, [])).toEqual([{ kind: "text", text: VERSE, key: "t0" }]);
  });

  it("returns nothing for empty text with no notes", () => {
    expect(verseSegments("", [])).toEqual([]);
  });

  it("splits the text around a single marker and preserves the string", () => {
    const segs = verseSegments(VERSE, [note({ char_offset: 8 })]);
    expect(segs.map((s) => s.kind)).toEqual(["text", "marker", "text"]);
    expect(textOf(segs)).toBe(VERSE);
    const markers = segs.filter((s) => s.kind === "marker");
    expect(markers.map((m) => (m.kind === "marker" ? m.number : 0))).toEqual([1]);
  });

  it("numbers markers sequentially per verse in (char_offset, ordinal) order, regardless of input order", () => {
    const segs = verseSegments(VERSE, [
      note({ char_offset: 40, ordinal: 3 }),
      note({ char_offset: 8, ordinal: 1 }),
      note({ char_offset: 20, ordinal: 2 }),
    ]);
    const markers = segs.filter((s) => s.kind === "marker");
    expect(markers.map((m) => (m.kind === "marker" ? m.number : 0))).toEqual([1, 2, 3]);
    expect(textOf(segs)).toBe(VERSE);
  });

  it("clusters notes that share an offset as adjacent markers (no empty text between)", () => {
    const segs = verseSegments(VERSE, [
      note({ char_offset: 8, ordinal: 1 }),
      note({ char_offset: 8, ordinal: 2 }),
    ]);
    // text, marker, marker, text — never an empty "" text segment between the two markers.
    expect(segs.map((s) => s.kind)).toEqual(["text", "marker", "marker", "text"]);
    expect(segs.every((s) => s.kind !== "text" || s.text.length > 0)).toBe(true);
    expect(textOf(segs)).toBe(VERSE);
  });

  it("clamps an out-of-range offset to the end and a negative offset to the start", () => {
    const high = verseSegments(VERSE, [note({ char_offset: 9999 })]);
    expect(textOf(high)).toBe(VERSE); // tail consumed; no trailing empty text segment
    expect(high.filter((s) => s.kind === "text").every((s) => s.kind === "text" && s.text)).toBe(
      true,
    );
    const low = verseSegments(VERSE, [note({ char_offset: -5 })]);
    expect(low[0]?.kind).toBe("marker"); // no leading empty text segment
    expect(textOf(low)).toBe(VERSE);
  });

  it("survives volume — 42 notes (Romans 8) render without loss, Greek intact", () => {
    const many = Array.from({ length: 42 }, (_, i) =>
      note({ char_offset: i, ordinal: i + 1, text: `note ${i} ἀγάπη` }),
    );
    const segs = verseSegments(VERSE, many);
    expect(segs.filter((s) => s.kind === "marker")).toHaveLength(42);
    expect(textOf(segs)).toBe(VERSE);
  });
});
