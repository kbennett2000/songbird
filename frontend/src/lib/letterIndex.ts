import { parseNoteMarkdown } from "@/lib/noteMarkdown";

/**
 * A long alphabetical document, read for its letters (v1.8): an index whose many `##` headings run
 * A to Z, such as a study Bible's index of themes printed in its front matter. Pure, so the About
 * page can offer a row of the letters it has, each going to its first heading. Decided from the
 * text's shape alone, never from its slug, title, kind or Bible, as a reading plan is.
 */

/** Fewer `##` headings than this is an ordinary document with sections, not an index. */
export const MIN_HEADINGS = 20;

/** Fewer first letters than this is a series ("Chapter 1" … "Epilogue"), not an index. */
export const MIN_LETTERS = 5;

export interface IndexLetter {
  /** "A" to "Z". */
  letter: string;
  /** Its first heading's place among the document's `##` headings, from 0. */
  heading: number;
}

export interface LetterIndex {
  /** Only the letters the headings start with, A to Z. */
  letters: IndexLetter[];
}

/** A heading's first letter, past any opening punctuation, without accents; null for a digit. */
function firstLetter(words: string): string | null {
  const first = /[\p{L}\p{N}]/u.exec(words)?.[0];
  const letter = first?.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return letter && /^[A-Z]$/.test(letter) ? letter : null;
}

/**
 * A document's letters, or null when it isn't an index: when it has fewer than `MIN_HEADINGS`
 * `##` headings, when any doesn't start with a letter A to Z, when the first letters ever go back
 * (whether an index sorts word by word or letter by letter, its first letters never do), or when
 * they span fewer than `MIN_LETTERS`. The headings are counted in the order the page draws them,
 * so the Nth is the Nth element marked `data-md-heading="2"`.
 */
export function parseLetterIndex(text: string): LetterIndex | null {
  const tokens = parseNoteMarkdown(text);
  const letters: IndexLetter[] = [];
  let headings = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type !== "heading_open" || t.tag !== "h2") continue;
    const words = (tokens[i + 1]?.children ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.content)
      .join("");
    const letter = firstLetter(words);
    const last = letters[letters.length - 1];
    if (!letter || (last && letter < last.letter)) return null;
    if (letter !== last?.letter) letters.push({ letter, heading: headings });
    headings++;
  }
  return headings >= MIN_HEADINGS && letters.length >= MIN_LETTERS ? { letters } : null;
}
