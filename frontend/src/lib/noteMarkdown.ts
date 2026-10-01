import MarkdownIt from "markdown-it";

/**
 * Markdown in Concord's notes (Concord v8, ADR-0011) — the pure half; `NoteMarkdown.tsx` renders.
 *
 * A study Bible's notes arrive as Markdown (`text_format: "markdown"`). They're **parsed** here
 * with markdown-it (already in the bundle: the note editor's tiptap-markdown uses it) and turned
 * into React elements by `NoteMarkdown`, never into an HTML string — so nothing is set as raw
 * HTML, matching `highlight.ts` and `verseSegments.ts`. Raw HTML in a note stays literal text
 * (`html: false`), and bare URLs stay text (`linkify: false`).
 *
 * The one kind of link that does something is a `ref:` link, `[words](ref:JHN.3.16)`: a passage
 * the reader can jump to. Any other link shows only its words.
 */

const md = new MarkdownIt("commonmark", { html: false, linkify: false, typographer: false });

/** One markdown-it token (block-level, or inline inside an `inline` token's `children`). */
export type MarkdownToken = ReturnType<typeof md.parse>[number];

/** Parse a note's Markdown into markdown-it's flat block-token stream. */
export function parseNoteMarkdown(text: string): MarkdownToken[] {
  return md.parse(text, {});
}

/** Where a `ref:` link jumps: a chapter (`verse` null) or the first verse of the passage. */
export interface RefTarget {
  book: string;
  chapter: number;
  verse: number | null;
}

// ADR-0011's grammar, exactly: a USFM code, then `.C`, `.C-C`, `.C.V`, `.C.V-V` or `.C.V-C.V`,
// numbers positive with no leading zero.
const NUM = "[1-9]\\d*";
const REF_TARGET = new RegExp(
  `^([1-4A-Z][A-Z0-9]{2})\\.(${NUM})(?:-(${NUM})|\\.(${NUM})(?:-(${NUM})(?:\\.(${NUM}))?)?)?$`,
);

/**
 * Parse a `ref:` TARGET ("JHN.3.16-4.2") into the place to jump to, or null when it's outside
 * the grammar or its range runs backwards. A range jumps to its start, the way a cross-reference
 * button does; a chapter or chapter range opens at the chapter's top.
 */
export function parseRefTarget(target: string): RefTarget | null {
  const m = REF_TARGET.exec(target);
  if (!m) return null;
  const [, book, c, chapterEnd, v, rangeEnd, rangeEndVerse] = m;
  const chapter = Number(c);
  if (chapterEnd !== undefined && Number(chapterEnd) < chapter) return null; // GEN.14-12
  if (v === undefined) return { book: book!, chapter, verse: null };
  const verse = Number(v);
  if (rangeEnd !== undefined) {
    if (rangeEndVerse === undefined) {
      if (Number(rangeEnd) < verse) return null; // JHN.3.18-16
    } else if (
      Number(rangeEnd) < chapter ||
      (Number(rangeEnd) === chapter && Number(rangeEndVerse) < verse)
    ) {
      return null; // JHN.4.2-3.16
    }
  }
  return { book: book!, chapter, verse };
}

/** A link destination's jump target, when it's a well-formed `ref:` link; otherwise null. */
export function refLinkTarget(href: string): RefTarget | null {
  return href.startsWith("ref:") ? parseRefTarget(href.slice("ref:".length)) : null;
}

/**
 * A Markdown note's search snippet as plain words, keeping Concord's `<mark>…</mark>` highlights.
 *
 * Concord cuts snippets from the raw Markdown, so one can hold link syntax, emphasis markers or a
 * list dash — and, at either edge, half a link. Links keep their words and lose their target
 * (also when the snippet cut them off); emphasis, code and line-start quote/list/heading markers
 * go. The result feeds the same `<mark>` splitter as any other snippet.
 */
export function markdownSnippetText(snippet: string): string {
  return (
    snippet
      // Whole links and images → their words.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // A link the snippet's end cut off, inside its target or inside its words.
      .replace(/!?\[([^\]]*)\]\([^)]*$/, "$1")
      .replace(/!?\[([^\]]*)$/, "$1")
      // A link the snippet's start cut off: "…words](ref:GEN.12)".
      .replace(/^([^[]*?)\]\([^)]*\)?/, "$1")
      // Line-start markers: block quotes, list items, headings.
      .replace(/^[ \t]{0,3}(?:>[ \t]?)+/gm, "")
      .replace(/^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      // Emphasis and code markers (an underscore only at a word's edge, as CommonMark reads it).
      .replace(/(?<!\\)(?:\*+|`+)/g, "")
      .replace(/(?<![\\\p{L}\p{N}])_+|(?<!\\)_+(?![\p{L}\p{N}])/gu, "")
      // Backslash escapes → the character itself.
      .replace(/\\([\\`*_[\]()#+\-.!>])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}
