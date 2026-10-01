import { useMemo } from "react";

import type { ShownNote } from "@/lib/borrowedNotes";
import { verseSegments } from "@/lib/verseSegments";

interface VerseTextProps {
  text: string;
  notes: ShownNote[];
  /** Open the note's popover, anchored to the tapped marker. */
  onOpenNote: (note: ShownNote, anchor: HTMLElement) => void;
}

/** A marker's name: the source's own label for the note's kind when it has one ("Study Note"). */
function markerName(note: ShownNote): string {
  return note.label ?? "Translator's note";
}

/**
 * Verse text with NET's translator's-note markers injected inline — superscript numbers at the
 * notes' `char_offset` positions (see {@link verseSegments} for the positioning invariant).
 * Markers are coloured distinctly from the blue verse numbers so the two systems don't read as
 * one; tapping a marker opens its note popover. A note borrowed from NET looks the same but says
 * so in its label.
 */
export function VerseText({ text, notes, onOpenNote }: VerseTextProps): JSX.Element {
  const segments = useMemo(() => verseSegments(text, notes), [text, notes]);

  return (
    <span>
      {segments.map((seg) =>
        seg.kind === "text" ? (
          <span key={seg.key}>{seg.text}</span>
        ) : (
          <button
            key={seg.key}
            type="button"
            className="align-super font-sans text-[0.7em] font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300 hover:underline"
            onClick={(e) => onOpenNote(seg.note, e.currentTarget)}
            aria-label={`${markerName(seg.note)} ${seg.number}${
              seg.note.borrowed ? ` (from ${seg.note.borrowed.from})` : ""
            }`}
            title={
              seg.note.borrowed
                ? `${markerName(seg.note)} (${seg.note.borrowed.from})`
                : markerName(seg.note)
            }
          >
            {seg.number}
          </button>
        ),
      )}
    </span>
  );
}
