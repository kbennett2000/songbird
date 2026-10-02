import { useMemo } from "react";

import type { ShownNote } from "@/lib/borrowedNotes";
import type { NoteLook } from "@/lib/noteLooks";
import { verseSegments } from "@/lib/verseSegments";

interface VerseTextProps {
  text: string;
  notes: ShownNote[];
  /** Open the note's popover, anchored to the tapped marker. */
  onOpenNote: (note: ShownNote, anchor: HTMLElement) => void;
  /** The look of the Bible a note came from (`noteLook`), so each Bible's markers differ. */
  lookOf: (note: ShownNote) => NoteLook;
}

/** A marker's name: the source's own label for the note's kind when it has one ("Study Note"). */
function markerName(note: ShownNote): string {
  return note.label ?? "Translator's note";
}

/**
 * Verse text with NET's translator's-note markers injected inline — superscript numbers at the
 * notes' `char_offset` positions (see {@link verseSegments} for the positioning invariant).
 * Markers are coloured distinctly from the blue verse numbers so the two systems don't read as
 * one, and each notes Bible's markers have their own colour and shape (`lib/noteLooks.ts`);
 * tapping a marker opens its note popover. A borrowed marker also names its Bible in its label.
 */
export function VerseText({ text, notes, onOpenNote, lookOf }: VerseTextProps): JSX.Element {
  const segments = useMemo(() => verseSegments(text, notes), [text, notes]);

  return (
    <span>
      {segments.map((seg) => {
        if (seg.kind === "text") return <span key={seg.key}>{seg.text}</span>;
        const look = lookOf(seg.note);
        return (
          <button
            key={seg.key}
            type="button"
            data-note-look={look.id}
            className={`align-super font-sans text-[0.7em] font-medium hover:underline ${look.colour}`}
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
            {look.shape ? <span className={look.shape}>{seg.number}</span> : seg.number}
          </button>
        );
      })}
    </span>
  );
}
