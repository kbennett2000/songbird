import { describe, expect, it } from "vitest";

import { markdownSnippetText, parseRefTarget, refLinkTarget } from "@/lib/noteMarkdown";

describe("parseRefTarget", () => {
  it.each([
    ["JHN.3", { book: "JHN", chapter: 3, verse: null }], // whole chapter
    ["GEN.12-14", { book: "GEN", chapter: 12, verse: null }], // chapter range → its first chapter
    ["JHN.3.16", { book: "JHN", chapter: 3, verse: 16 }], // one verse
    ["JHN.3.16-18", { book: "JHN", chapter: 3, verse: 16 }], // verse range → its first verse
    ["JHN.3.16-4.2", { book: "JHN", chapter: 3, verse: 16 }], // cross-chapter range
    ["1SA.17.4", { book: "1SA", chapter: 17, verse: 4 }], // a numbered book
    ["GEN.12-12", { book: "GEN", chapter: 12, verse: null }], // a one-chapter "range"
  ])("reads %s", (target, expected) => {
    expect(parseRefTarget(target)).toEqual(expected);
  });

  it.each([
    "jhn.3.16", // codes are exact upper case
    "John.3.16", // a name, not a USFM code
    "JHN 3:16", // a reference string, not a target
    "JHN.03.16", // leading zero
    "JHN.0", // chapters start at 1
    "JHN.3.0",
    "JHN.3-4.2", // a chapter range can't end on a verse
    "JHN.3.16-", // dangling range
    "JHN", // no chapter
    "GEN.14-12", // backwards ranges
    "JHN.3.18-16",
    "JHN.4.2-3.16",
    "JHN.3.16-3.12",
  ])("rejects %s", (target) => {
    expect(parseRefTarget(target)).toBeNull();
  });
});

describe("refLinkTarget", () => {
  it("only a ref: destination jumps", () => {
    expect(refLinkTarget("ref:ROM.5.8")).toEqual({ book: "ROM", chapter: 5, verse: 8 });
    expect(refLinkTarget("https://example.com/ROM.5.8")).toBeNull();
    expect(refLinkTarget("ROM.5.8")).toBeNull();
    expect(refLinkTarget("ref:not-a-target")).toBeNull();
  });
});

describe("markdownSnippetText", () => {
  it("keeps a link's words and drops its target", () => {
    expect(markdownSnippetText("as in [the next chapter](ref:GEN.13) here")).toBe(
      "as in the next chapter here",
    );
  });

  it("keeps the <mark> highlights, inside and outside links", () => {
    expect(
      markdownSnippetText("a *made-up* <mark>word</mark>, see [<mark>word</mark>](ref:GEN.1)"),
    ).toBe("a made-up <mark>word</mark>, see <mark>word</mark>");
  });

  it("copes with a link the snippet's end cut off", () => {
    expect(markdownSnippetText("then see [the next ch")).toBe("then see the next ch");
    expect(markdownSnippetText("then see [the next](ref:GE")).toBe("then see the next");
  });

  it("copes with a link the snippet's start cut off", () => {
    expect(markdownSnippetText("…apter](ref:GEN.13) and more")).toBe("…apter and more");
    expect(markdownSnippetText("…apter](ref:GE")).toBe("…apter");
  });

  it("drops emphasis, code and line-start markers", () => {
    const md = "> quoted *line*\n- a **list** item\n2. a _numbered_ one\n## a heading\n`code`";
    expect(markdownSnippetText(md)).toBe("quoted line a list item a numbered one a heading code");
  });

  it("leaves underscores inside a word, and hyphens in prose, alone", () => {
    expect(markdownSnippetText("a snake_case word - and a well-known one")).toBe(
      "a snake_case word - and a well-known one",
    );
  });

  it("turns escaped characters back into themselves", () => {
    expect(markdownSnippetText("five \\* stars and a \\[bracket\\]")).toBe(
      "five * stars and a [bracket]",
    );
  });
});
