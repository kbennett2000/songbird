import { describe, expect, it } from "vitest";

import { introductionFor } from "@/lib/introductions";
import type { DocumentSummary } from "@/schemas";

describe("introductionFor", () => {
  const doc = (book: string | null, kind = "book-introduction"): DocumentSummary => ({
    slug: `made-up-${book ?? kind}`,
    kind,
    title: `Made-up ${book ?? kind}`,
    book,
    ordinal: 1,
  });

  it("finds the open book's introduction, and nothing for a book without one", () => {
    const list = [doc("GEN"), doc("EXO"), doc(null, "front-matter")];
    expect(introductionFor(list, "EXO")?.slug).toBe("made-up-EXO");
    expect(introductionFor(list, "LEV")).toBeUndefined();
    expect(introductionFor(undefined, "GEN")).toBeUndefined();
  });
});
