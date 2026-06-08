import { type KeyboardEvent, useMemo, useState } from "react";

interface TagInputProps {
  value: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Chip-style tag input with type-ahead (SPEC §8.6): add on Enter/comma, create-on-the-fly,
 * remove via ×, autocomplete from existing tags. */
export function TagInput({ value, suggestions, onChange }: TagInputProps): JSX.Element {
  const [draft, setDraft] = useState("");

  const matches = useMemo(() => {
    const q = normalize(draft);
    if (!q) return [];
    return suggestions.filter((s) => s.includes(q) && !value.includes(s)).slice(0, 6);
  }, [draft, suggestions, value]);

  const add = (raw: string) => {
    const tag = normalize(raw);
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  };

  return (
    <div>
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Tags</span>
      <div className="mt-1 flex flex-wrap items-center gap-1 rounded border border-gray-300 dark:border-gray-600 p-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-sm text-blue-800 dark:text-blue-300"
          >
            {tag}
            <button
              type="button"
              className="text-blue-500 hover:text-blue-800"
              onClick={() => remove(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Add a tag…"
          aria-label="Add a tag"
          className="min-w-[6rem] flex-1 text-sm outline-none"
        />
      </div>
      {matches.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {matches.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="rounded border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => add(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
