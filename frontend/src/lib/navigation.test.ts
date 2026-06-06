import { describe, expect, it } from "vitest";

import { nextChapter, prevChapter } from "@/lib/navigation";
import type { Book } from "@/schemas";

function book(id: string, name: string, chapter_count: number, canonical_order: number): Book {
  return { id, name, testament: "NT", chapter_count, canonical_order };
}

// A tiny canon slice spanning a boundary, plus the two ends for clamping.
const BOOKS: Book[] = [
  book("GEN", "Genesis", 50, 1),
  book("LUK", "Luke", 24, 42),
  book("JHN", "John", 21, 43),
  book("ACT", "Acts", 28, 44),
  book("REV", "Revelation", 22, 66),
];

describe("nextChapter", () => {
  it("moves within a book", () => {
    expect(nextChapter(BOOKS, "JHN", 3)).toEqual({ book: "JHN", chapter: 4 });
  });

  it("rolls past the end of a book into the next book's chapter 1", () => {
    expect(nextChapter(BOOKS, "JHN", 21)).toEqual({ book: "ACT", chapter: 1 });
  });

  it("clamps at the end of the canon (Revelation 22 → null)", () => {
    expect(nextChapter(BOOKS, "REV", 22)).toBeNull();
  });
});

describe("prevChapter", () => {
  it("moves within a book", () => {
    expect(prevChapter(BOOKS, "JHN", 3)).toEqual({ book: "JHN", chapter: 2 });
  });

  it("rolls before the start of a book into the previous book's last chapter", () => {
    expect(prevChapter(BOOKS, "JHN", 1)).toEqual({ book: "LUK", chapter: 24 });
  });

  it("clamps at the start of the canon (Genesis 1 → null)", () => {
    expect(prevChapter(BOOKS, "GEN", 1)).toBeNull();
  });
});
