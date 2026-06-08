import { useState } from "react";

export interface SermonNoteFormValues {
  title: string;
  sermon_url: string;
  reference: string;
  event_date: string | null; // "" → null
}

interface SermonNoteFormProps {
  initial: SermonNoteFormValues;
  saving?: boolean;
  onSave: (values: SermonNoteFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const fieldClass =
  "mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm outline-none focus:border-blue-500";

/**
 * Author / edit a sermon note: title, the sermon URL (the body — an external link, invariant 6
 * doesn't apply since there's no Markdown), a free-text Scripture reference (prefilled from the
 * anchored verse), and an optional date. Tags live in the shared TagInput above this form, the
 * same as the annotation editor. Mirrors {@link NoteEditor}'s Save/Cancel/Delete shape.
 */
export function SermonNoteForm({
  initial,
  saving,
  onSave,
  onCancel,
  onDelete,
}: SermonNoteFormProps): JSX.Element {
  const [title, setTitle] = useState(initial.title);
  const [url, setUrl] = useState(initial.sermon_url);
  const [reference, setReference] = useState(initial.reference);
  const [date, setDate] = useState(initial.event_date ?? "");

  const canSave = title.trim() !== "" && url.trim() !== "" && reference.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      sermon_url: url.trim(),
      reference: reference.trim(),
      event_date: date.trim() === "" ? null : date.trim(),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sermon title"
          className={fieldClass}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        Sermon URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className={fieldClass}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        Reference
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. John 3:16"
          className={fieldClass}
        />
      </label>

      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={fieldClass}
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving || !canSave}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={onCancel}
        >
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            className="ml-auto rounded px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
