import { describe, expect, it } from "vitest";

import { introductionFor, introductionSources } from "@/lib/introductions";
import type { DocumentSummary } from "@/schemas";

const t = (id: string, document_count?: number | null) => ({ id, document_count });

describe("introductionSources", () => {
  it("offers the Bible being read first, then the ticked ones, each only with documents", () => {
    const translations = [t("AAA", 66), t("BBB", 0), t("CCC", 12), t("KJV", 0)];
    expect(introductionSources(translations, "AAA", ["CCC", "BBB"])).toEqual(["AAA", "CCC"]);
    expect(introductionSources(translations, "KJV", ["CCC"])).toEqual(["CCC"]);
    // The ticked order is kept.
    expect(introductionSources([t("X", 1), t("Y", 1)], "KJV", ["Y", "X"])).toEqual(["Y", "X"]);
  });

  it("offers none against an older Concord, which sends no document count", () => {
    expect(introductionSources([t("AAA"), t("KJV", null)], "AAA", ["KJV"])).toEqual([]);
  });

  it("never offers a Bible twice", () => {
    expect(introductionSources([t("AAA", 66)], "AAA", ["AAA"])).toEqual(["AAA"]);
  });
});

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
