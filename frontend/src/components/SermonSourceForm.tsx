import { useState } from "react";

import { TagInput } from "@/components/TagInput";

export interface SermonSourceFormValues {
  url: string;
  tags: string[];
  enabled: boolean;
  include_live: boolean;
  /** Null means "follow the app-wide default" — an empty field, not a zero. */
  min_minutes: number | null;
}

interface SermonSourceFormProps {
  /** Adding shows the URL field; editing shows the link it resolved from, read-only. */
  mode: "add" | "edit";
  initial: SermonSourceFormValues;
  /** Existing tag names, for the type-ahead. */
  suggestions: string[];
  /** The app-wide SERMON_MIN_MINUTES, shown as the placeholder rather than filled in. */
  minMinutesDefault: number;
  saving?: boolean;
  onSave: (values: SermonSourceFormValues) => void;
  onCancel: () => void;
}

const fieldClass =
  "mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-sm outline-none focus:border-blue-500";

/**
 * Add or edit a sermon source: the channel/playlist link, tags from the shared vocabulary, and
 * the two filters that decide what counts as a sermon.
 *
 * The minimum-minutes field is deliberately EMPTY by default, with the app-wide value as its
 * placeholder. Prefilling the number would write a copy of today's default onto every source,
 * and raising the app-wide floor later would then reach none of them.
 */
export function SermonSourceForm({
  mode,
  initial,
  suggestions,
  minMinutesDefault,
  saving,
  onSave,
  onCancel,
}: SermonSourceFormProps): JSX.Element {
  const [url, setUrl] = useState(initial.url);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [includeLive, setIncludeLive] = useState(initial.include_live);
  // Held as text so the field can be genuinely empty, which is what "use the default" looks like.
  const [minMinutes, setMinMinutes] = useState(
    initial.min_minutes === null ? "" : String(initial.min_minutes),
  );

  const canSave = mode === "edit" || url.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    const trimmed = minMinutes.trim();
    onSave({
      url: url.trim(),
      tags,
      enabled,
      include_live: includeLive,
      min_minutes: trimmed === "" ? null : Number(trimmed),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {mode === "add" ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Channel or playlist link
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/@yourchurch"
              className={fieldClass}
            />
          </label>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Open the church’s YouTube page and copy the address. A playlist link works too, if
            they keep one just for sermons.
          </p>
        </div>
      ) : (
        <div>
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            Added from
          </span>
          <p className="mt-1 break-all text-sm text-gray-500 dark:text-gray-400">{initial.url}</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            To follow a different channel, delete this one and add the new one.
          </p>
        </div>
      )}

      <TagInput value={tags} suggestions={suggestions} onChange={setTags} />

      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Check this source for new sermons
        </label>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
        <input
          type="checkbox"
          checked={includeLive}
          onChange={(e) => setIncludeLive(e.target.checked)}
          className="h-4 w-4"
        />
        Include past livestreams
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
          Shortest video to count as a sermon
          <input
            type="number"
            min={1}
            value={minMinutes}
            onChange={(e) => setMinMinutes(e.target.value)}
            placeholder={`${minMinutesDefault} minutes`}
            className={fieldClass}
          />
        </label>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Leave this blank to use {minMinutesDefault} minutes, which skips announcements and
          clips. Set a number here if this church is different.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving || !canSave}
        >
          {saving ? "Saving…" : mode === "add" ? "Add source" : "Save"}
        </button>
        <button
          type="button"
          className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
