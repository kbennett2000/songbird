import type { TranslatorNote } from "@/schemas";

/**
 * Borrowing NET's translator's notes onto another translation (ADR 0004).
 *
 * A note's `char_offset` is a point anchor into NET's OWN verse text — just after the word or
 * phrase it comments on — and it doesn't carry that word. Concord has no English word alignment,
 * so placing the note in (say) the ESV is songbird's best guess, made as honestly as possible:
 *
 * 1. Take the NET words just before the anchor.
 * 2. Look for the last 3 of them in the other translation's verse, then the last 2, then the last
 *    1 — punctuation and case ignored. A match is used only when it occurs EXACTLY once (once a
 *    phrase is ambiguous, every shorter one is too, so the search stops there).
 * 3. No confident match → the marker sits at the end of the verse. A note anchored at the very
 *    start of NET's verse (no words before it — a verse-level note) sits at the start.
 *
 * The note always carries the NET words it's about (`borrowed.phrase`), so the popover can show
 * what it refers to wherever the marker landed. Notes join verses on the canonical verse number
 * (invariant 4); nothing here is stored. Pure + testable.
 */

/** The one translation Concord has translator's notes for — the source the reader can borrow. */
export const NOTES_SOURCE = "NET";

/** A translator's note as the reader shows it — its own, or borrowed from {@link NOTES_SOURCE}. */
export type ShownNote = TranslatorNote & {
  borrowed?: {
    /** The translation the note came from, e.g. "NET". */
    from: string;
    /** Up to six of that translation's words ending at the anchor ("…be subject to rulers and"). */
    phrase: string;
  };
};

interface Word {
  norm: string;
  start: number;
  end: number;
}

// A word: letters/digits, with inner apostrophes kept ("Lord's", "don’t").
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const MATCH_WORDS = 3;
const PHRASE_WORDS = 6;

/** The words in `text`, lower-cased with curly apostrophes straightened, with their positions. */
export function words(text: string): Word[] {
  return Array.from(text.matchAll(WORD), (m) => ({
    norm: m[0].toLowerCase().replace(/’/g, "'"),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/** Where the words before a note land in the target verse, or null when there's no single spot. */
function matchedOffset(before: Word[], target: Word[]): number | null {
  for (let k = Math.min(MATCH_WORDS, before.length); k >= 1; k--) {
    const tail = before.slice(-k).map((w) => w.norm);
    const hits: number[] = [];
    for (let i = 0; i + k <= target.length; i++) {
      if (tail.every((norm, j) => target[i + j]?.norm === norm)) {
        hits.push(target[i + k - 1]!.end);
      }
    }
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}

/** Place one note from `sourceText` (NET's verse) into `targetText` (the verse being read). */
export function placeBorrowedNote(
  note: TranslatorNote,
  sourceText: string,
  targetText: string,
  from: string = NOTES_SOURCE,
): ShownNote {
  const before = words(sourceText).filter((w) => w.end <= note.char_offset);
  const offset =
    before.length === 0 ? 0 : (matchedOffset(before, words(targetText)) ?? targetText.length);

  const shown = before.slice(-PHRASE_WORDS);
  const first = shown[0];
  const last = shown[shown.length - 1];
  const phrase =
    first && last
      ? `${before.length > PHRASE_WORDS ? "…" : ""}${sourceText.slice(first.start, last.end)}`
      : "";

  return { ...note, char_offset: offset, borrowed: { from, phrase } };
}

interface VerseLike {
  verse: number;
  text: string | null;
}

/**
 * Place a chapter's NET notes onto the verses being read, grouped by verse number. A note whose
 * verse the target translation doesn't have (or has no text for) is left out — there's nothing
 * to attach it to.
 */
export function borrowNotes(
  notes: TranslatorNote[],
  sourceVerses: VerseLike[],
  targetVerses: VerseLike[],
  from: string = NOTES_SOURCE,
): Map<number, ShownNote[]> {
  const sourceText = new Map(sourceVerses.map((v) => [v.verse, v.text ?? ""]));
  const targetText = new Map(targetVerses.map((v) => [v.verse, v.text]));
  const byVerse = new Map<number, ShownNote[]>();
  for (const note of notes) {
    const target = targetText.get(note.verse);
    if (!target) continue;
    const placed = placeBorrowedNote(note, sourceText.get(note.verse) ?? "", target, from);
    const list = byVerse.get(note.verse);
    if (list) list.push(placed);
    else byVerse.set(note.verse, [placed]);
  }
  return byVerse;
}
