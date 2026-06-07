import { Popover } from "@/components/Popover";
import type { SermonNote } from "@/schemas";

interface SermonNotePopoverProps {
  note: SermonNote;
  /** The tapped sermon marker the popover anchors to. */
  anchor: HTMLElement;
  onClose: () => void;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Format an ISO `YYYY-MM-DD` without `new Date()` timezone shifting (parse the parts directly). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * A floating popover for one sermon note, anchored to its reader marker. Shows the title, the
 * sermon URL as a plain EXTERNAL link (new tab; no embed, no fetch — songbird stays
 * offline-capable, and the link simply won't resolve offline), the passage reference, the
 * sermon date, and tags. Positioning + dismissal live in the shared {@link Popover} shell.
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

      <h3 className="font-semibold text-gray-900">{note.title}</h3>

      <p className="mt-0.5 text-xs text-gray-500">
        {note.reference}
        {note.event_date ? ` · ${formatDate(note.event_date)}` : ""}
      </p>

      <a
        href={note.sermon_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block font-medium text-emerald-700 hover:underline"
      >
        ▶ Watch the sermon
      </a>

      {note.tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 pt-2">
          {note.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
