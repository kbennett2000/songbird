import type { SermonNote } from "@/schemas";

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

interface SermonNoteFieldsProps {
  note: SermonNote;
  /** Optional author actions — rendered only when supplied (read-only popovers omit them). */
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * The per-sermon body shared by the single-sermon popover and each row of the stacked
 * multi-sermon popover: title, reference + date, the sermon URL as a plain EXTERNAL link (new
 * tab; no embed, no fetch — songbird stays offline-capable), and tags. Single source of truth
 * for the safe-link attributes and the tz-safe date format. When `onEdit`/`onDelete` are passed,
 * Edit/Delete actions are appended so a sermon can be managed from the reader.
 */
export function SermonNoteFields({ note, onEdit, onDelete }: SermonNoteFieldsProps): JSX.Element {
  return (
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{note.title}</h3>

      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
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
        <ul className="mt-2 flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <li key={tag} className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
              {tag}
            </li>
          ))}
        </ul>
      )}

      {(onEdit || onDelete) && (
        <div className="mt-2 flex gap-3 text-xs">
          {onEdit && (
            <button
              type="button"
              className="font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800"
              onClick={onEdit}
              aria-label={`Edit sermon — ${note.title}`}
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="font-medium text-red-500 hover:text-red-700"
              onClick={onDelete}
              aria-label={`Delete sermon — ${note.title}`}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
