import { useMemo } from "react";

import { Popover } from "@/components/Popover";
import { SermonNoteFields } from "@/components/SermonNoteFields";
import type { SermonNote } from "@/schemas";

interface SermonNotesPopoverProps {
  /** All sermon notes covering the tapped verse (≥2 — the single-note case uses SermonNotePopover). */
  notes: SermonNote[];
  anchor: HTMLElement;
  onClose: () => void;
  onEdit?: (note: SermonNote) => void;
  onDelete?: (note: SermonNote) => void;
}

/** Newest sermon first: event_date DESC, NULLS LAST, then created_at as a stable tiebreaker. */
function byNewest(a: SermonNote, b: SermonNote): number {
  if (a.event_date !== b.event_date) {
    if (a.event_date === null) return 1; // nulls last
    if (b.event_date === null) return -1;
    return a.event_date < b.event_date ? 1 : -1; // ISO dates compare lexicographically
  }
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

/**
 * A floating popover listing EVERY sermon note on a verse — the multi-sermon case, so none is
 * hidden behind `[0]`. One tap shows the whole catalog for the verse; each sermon is a compact
 * row reusing {@link SermonNoteFields} (title · date · external link · tags). Shares the
 * {@link Popover} shell, so a tall list scrolls inside the popover (the #18 inside-scroll fix).
 */
export function SermonNotesPopover({
  notes,
  anchor,
  onClose,
  onEdit,
  onDelete,
}: SermonNotesPopoverProps): JSX.Element {
  const sorted = useMemo(() => [...notes].sort(byNewest), [notes]);
  return (
    <Popover anchor={anchor} onClose={onClose} ariaLabel={`${notes.length} sermons on this verse`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Sermons · {notes.length}
        </span>
        <button
          type="button"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <ul className="flex flex-col">
        {sorted.map((note) => (
          <li key={note.id} className="border-t border-gray-100 py-2 first:border-0 first:pt-0">
            <SermonNoteFields
              note={note}
              onEdit={onEdit ? () => onEdit(note) : undefined}
              onDelete={onDelete ? () => onDelete(note) : undefined}
            />
          </li>
        ))}
      </ul>
    </Popover>
  );
}
