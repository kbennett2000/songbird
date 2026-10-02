import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { TopNav } from "@/components/TopNav";
import { useShowNotesFrom } from "@/hooks/useShowNotesFrom";
import { type Theme, useThemeControl } from "@/hooks/useTheme";
import { noteSources } from "@/lib/borrowedNotes";
import { translationsOptions } from "@/lib/reader";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match this device" },
];

const MORE = [
  {
    to: "/sermon-sources",
    label: "Sermon sources",
    about: "Follow a church's YouTube channel and file its sermons as notes",
  },
  {
    to: "/status",
    label: "Status",
    about: "Which Concord songbird reads from, and the translations it serves",
  },
] as const;

/**
 * The things you set once and leave: which Bibles' notes follow you into other translations,
 * light or dark, and the two utility pages (Sermon sources, Status). They used to crowd the top
 * bar and the reader's bar; a choice made here saves to the profile as soon as it's made.
 */
export function SettingsView(): JSX.Element {
  const translations = useQuery(translationsOptions);
  const { showNotesFrom, setShowNotesFrom } = useShowNotesFrom();
  const { theme, setTheme } = useThemeControl();

  // Every notes source, always — unlike the reader's menu, nothing is being read here.
  const sources = noteSources(translations.data ?? []);
  const names = new Map((translations.data ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      <TopNav maxWidth="max-w-3xl" />
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

        <section className="mt-6" aria-labelledby="settings-notes">
          <h2 id="settings-notes" className="text-lg font-semibold">
            Notes from other Bibles
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Tick a Bible to show its notes while you read other translations.
          </p>

          {translations.isPending && (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          )}
          {/* An unreachable Concord is an error, never an empty list (invariant 3). */}
          {translations.isError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              Couldn&rsquo;t load the Bibles from Concord. Is it reachable?
            </p>
          )}
          {translations.isSuccess && sources.length === 0 && (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              None of the Bibles in this Concord has notes.
            </p>
          )}
          {sources.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700">
              {sources.map((code) => (
                <li key={code}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={showNotesFrom.includes(code)}
                      onChange={(e) => setShowNotesFrom(code, e.target.checked)}
                    />
                    <span className="w-12 shrink-0 font-mono font-medium">{code}</span>
                    <span>{names.get(code) ?? code}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <fieldset className="mt-8">
          <legend className="text-lg font-semibold">Appearance</legend>
          <div className="mt-2 flex flex-col sm:flex-row sm:gap-6">
            {THEMES.map((t) => (
              <label key={t.value} className="flex cursor-pointer items-center gap-2 py-2">
                <input
                  type="radio"
                  name="theme"
                  value={t.value}
                  className="h-4 w-4"
                  checked={theme === t.value}
                  onChange={() => setTheme(t.value)}
                />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        <section className="mt-8" aria-labelledby="settings-more">
          <h2 id="settings-more" className="text-lg font-semibold">
            More
          </h2>
          <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700">
            {MORE.map((m) => (
              <li key={m.to}>
                <Link
                  to={m.to}
                  className="-mx-2 block rounded px-2 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 sm:flex sm:items-baseline sm:gap-3"
                >
                  <span className="font-medium text-blue-700 dark:text-blue-400 sm:w-36 sm:shrink-0">
                    {m.label} ›
                  </span>
                  <span className="block text-sm text-gray-600 dark:text-gray-400">{m.about}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
