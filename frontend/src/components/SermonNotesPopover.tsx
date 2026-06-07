import { Popover } from "@/components/Popover";
import { SermonNoteFields } from "@/components/SermonNoteFields";
import type { SermonNote } from "@/schemas";

interface SermonNotesPopoverProps {
  /** All sermon notes covering the tapped verse (≥2 — the single-note case uses SermonNotePopover). */
  notes: SermonNote[];
  anchor: HTMLElement;
  onClose: () => void;
}

/**
 * A floating popover listing EVERY sermon note on a verse — the multi-sermon case, so none is
 * hidden behind `[0]`. One tap shows the whole catalog for the verse; each sermon is a compact
 * row reusing {@link SermonNoteFields} (title · date · external link · tags). Shares the
 * {@link Popover} shell, so a tall list scrolls inside the popover (the #18 inside-scroll fix).
 */
export function SermonNotesPopover({ notes, anchor, onClose }: SermonNotesPopoverProps): JSX.Element {
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
        {notes.map((note) => (
          <li key={note.id} className="border-t border-gray-100 py-2 first:border-0 first:pt-0">
            <SermonNoteFields note={note} />
          </li>
        ))}
      </ul>
    </Popover>
  );
}
