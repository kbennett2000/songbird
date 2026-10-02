import { describe, expect, it } from "vitest";

import { aboutGroups, aboutKindLabel, documentSources } from "@/lib/documents";
import type { DocumentSummary } from "@/schemas";

const t = (id: string, document_count?: number | null) => ({ id, document_count });

describe("documentSources", () => {
  it("offers the Bible being read first, then the ticked ones, each only with documents", () => {
    const translations = [t("AAA", 66), t("BBB", 0), t("CCC", 12), t("KJV", 0)];
    expect(documentSources(translations, "AAA", ["CCC", "BBB"])).toEqual(["AAA", "CCC"]);
    expect(documentSources(translations, "KJV", ["CCC"])).toEqual(["CCC"]);
    // The ticked order is kept.
    expect(documentSources([t("X", 1), t("Y", 1)], "KJV", ["Y", "X"])).toEqual(["Y", "X"]);
  });

  it("offers none against an older Concord, which sends no document count", () => {
    expect(documentSources([t("AAA"), t("KJV", null)], "AAA", ["KJV"])).toEqual([]);
  });

  it("never offers a Bible twice", () => {
    expect(documentSources([t("AAA", 66)], "AAA", ["AAA"])).toEqual(["AAA"]);
  });
});

describe("aboutGroups", () => {
  const doc = (kind: string, ordinal: number, book: string | null = null): DocumentSummary => ({
    slug: `${kind}-${ordinal}`,
    kind,
    title: `Made-up ${kind} ${ordinal}`,
    book,
    ordinal,
  });

  it("groups the front matter, reading plan and notes on the edition, in that order", () => {
    const list = [
      doc("about", 1),
      doc("front-matter", 1),
      doc("book-introduction", 1, "GEN"),
      doc("front-matter", 2),
      doc("reading-plan", 1),
      doc("made-up-kind", 1),
    ];
    const groups = aboutGroups(list);
    expect(groups.map((g) => g.label)).toEqual([
      "Front matter",
      "Reading plan",
      "About the edition",
    ]);
    // Each group keeps Concord's order.
    expect(groups[0]!.documents.map((d) => d.slug)).toEqual(["front-matter-1", "front-matter-2"]);
  });

  it("is empty for a Bible with only book introductions, or no list yet", () => {
    expect(aboutGroups([doc("book-introduction", 1, "GEN")])).toEqual([]);
    expect(aboutGroups(undefined)).toEqual([]);
  });

  it("names only the kinds it shows", () => {
    expect(aboutKindLabel("reading-plan")).toBe("Reading plan");
    expect(aboutKindLabel("book-introduction")).toBeNull();
  });
});
