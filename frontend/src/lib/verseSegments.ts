import type { ShownNote } from "@/lib/borrowedNotes";

/**
 * Split a verse string into text runs interleaved with translator's-note markers.
 *
 * The load-bearing invariant: Concord's `char_offset` is a point anchor into the SAME verse
 * string songbird renders (the text flows verbatim Concord → reader, escaped only by React's
 * text-node escaping, which does not shift indices). So we slice the string by index — never
 * `dangerouslySetInnerHTML`, so each text slice stays React-escaped. Verse text is BMP
 * (English/Latin), so a JS UTF-16 index matches Concord's codepoint offset. Offsets are clamped
 * to [0, len] to survive any data drift, and the text slices always reconstruct the original
 * string exactly (covered by an alignment test).
 *
 * Markers are numbered sequentially per verse (1, 2, 3…) in (char_offset, ordinal) order —
 * NET's own footnote numbers are deliberately not shown, since they'd collide with the verse
 * numbers. Notes sharing an offset cluster as adjacent markers: the translation's own first, then
 * borrowed ones, sources in the reader's checkbox order (see borrowedNotes.ts). Pure + testable.
 */

export type VerseSegment =
  | { kind: "text"; text: string; key: string }
  | { kind: "marker"; note: ShownNote; number: number; key: string };

/** 0 for the translation's own note, then 1, 2, … for each borrowed source in checkbox order. */
function sourceRank(note: ShownNote): number {
  return note.borrowed ? 1 + note.borrowed.rank : 0;
}

export function verseSegments(text: string, notes: ShownNote[]): VerseSegment[] {
  if (notes.length === 0) return text ? [{ kind: "text", text, key: "t0" }] : [];

  const len = text.length;
  const placed = notes
    .map((note) => ({ note, offset: Math.min(Math.max(note.char_offset, 0), len) }))
    .sort(
      (a, b) =>
        a.offset - b.offset ||
        sourceRank(a.note) - sourceRank(b.note) ||
        a.note.ordinal - b.note.ordinal,
    );

  const segments: VerseSegment[] = [];
  let cursor = 0;
  placed.forEach((item, i) => {
    if (item.offset > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, item.offset), key: `t${cursor}` });
      cursor = item.offset;
    }
    segments.push({
      kind: "marker",
      note: item.note,
      number: i + 1,
      // Ordinals are only unique within one source, so a borrowed marker's key names its source.
      key: `m${item.note.borrowed ? `b${item.note.borrowed.from}-` : ""}${item.note.ordinal}-${item.offset}`,
    });
  });
  if (cursor < len) segments.push({ kind: "text", text: text.slice(cursor), key: `t${cursor}` });
  return segments;
}
