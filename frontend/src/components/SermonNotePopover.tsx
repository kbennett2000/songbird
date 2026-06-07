import { Popover } from "@/components/Popover";
import { SermonNoteFields } from "@/components/SermonNoteFields";
import type { SermonNote } from "@/schemas";

interface SermonNotePopoverProps {
  note: SermonNote;
  /** The tapped sermon marker the popover anchors to. */
  anchor: HTMLElement;
  onClose: () => void;
}

/**
 * A floating popover for ONE sermon note, anchored to its reader marker (the single-sermon verse
 * case). The per-sermon body lives in {@link SermonNoteFields}; positioning + dismissal in the
 * shared {@link Popover} shell.
 */
export function SermonNotePopover({ note, anchor, onClose }: SermonNotePopoverProps): JSX.Element {
  return (
    <Popover anchor={anchor} onClose={onClose} ariaLabel={`Sermon — ${note.title}`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Sermon
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

      <SermonNoteFields note={note} />
    </Popover>
  );
}
