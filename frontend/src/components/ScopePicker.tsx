import type { Scope, ScopeType, Translation } from "@/schemas";

interface ScopePickerProps {
  value: Scope;
  currentTranslation: string;
  availableTranslations: Translation[];
  onChange: (scope: Scope) => void;
}

/**
 * The three-tier translation scope (SPEC §2 / §8.5): default **All**, one-tap **this
 * translation only** (current), and a **choose translations…** checklist (subset).
 */
export function ScopePicker({
  value,
  currentTranslation,
  availableTranslations,
  onChange,
}: ScopePickerProps): JSX.Element {
  const select = (type: ScopeType) => {
    if (type === "all") onChange({ type: "all", translations: [] });
    else if (type === "current")
      onChange({ type: "current", translations: [currentTranslation] });
    else onChange({ type: "subset", translations: value.translations });
  };

  const toggle = (code: string) => {
    const has = value.translations.includes(code);
    const translations = has
      ? value.translations.filter((c) => c !== code)
      : [...value.translations, code];
    onChange({ type: "subset", translations });
  };

  return (
    <fieldset className="flex flex-col gap-2 rounded border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-700">Shows in</legend>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="scope"
          checked={value.type === "all"}
          onChange={() => select("all")}
        />
        All translations
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="scope"
          checked={value.type === "current"}
          onChange={() => select("current")}
        />
        This translation only ({currentTranslation})
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="scope"
          checked={value.type === "subset"}
          onChange={() => select("subset")}
        />
        Choose translations…
      </label>

      {value.type === "subset" && (
        <div className="ml-6 grid grid-cols-2 gap-1">
          {availableTranslations.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.translations.includes(t.id)}
                onChange={() => toggle(t.id)}
              />
              {t.id}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
