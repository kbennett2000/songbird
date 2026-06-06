import { useMemo } from "react";

import { verseSegments } from "@/lib/verseSegments";
import type { TranslatorNote } from "@/schemas";

interface VerseTextProps {
  text: string;
  notes: TranslatorNote[];
  /** Open the note's popover, anchored to the tapped marker. */
  onOpenNote: (note: TranslatorNote, anchor: HTMLElement) => void;
}

/**
 * Verse text with NET's translator's-note markers injected inline — superscript numbers at the
 * notes' `char_offset` positions (see {@link verseSegments} for the positioning invariant).
 * Markers are coloured distinctly from the blue verse numbers so the two systems don't read as
 * one; tapping a marker opens its note popover.
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
            className="align-super font-sans text-[0.7em] font-medium text-violet-600 hover:text-violet-800 hover:underline"
            onClick={(e) => onOpenNote(seg.note, e.currentTarget)}
            aria-label={`Translator's note ${seg.number}`}
            title="Translator's note"
          >
            {seg.number}
          </button>
        ),
      )}
    </span>
  );
}
