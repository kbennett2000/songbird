import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { TopNav } from "@/components/TopNav";
import { useReadingTranslation } from "@/hooks/useReadingTranslation";
import { markSegments } from "@/lib/highlight";
import { noteReference, notePreview, readerLink, studyNoteBadge } from "@/lib/notes";
import {
  fetchBooks,
  fetchTranslations,
  keywordSearch,
  searchAnnotations,
  searchStudyNotes,
  semanticSearch,
} from "@/lib/reader";
import type { KeywordResult, SemanticResult } from "@/schemas";

type Mode = "semantic" | "keyword";

// Render a Concord <mark>…</mark> snippet as safe React nodes (split on the tags — never raw HTML).
function highlighted(snippet: string): JSX.Element[] {
  return markSegments(snippet).map((s) =>
    s.mark ? (
      <mark key={s.key} className="rounded bg-yellow-200">
        {s.text}
      </mark>
    ) : (
      <span key={s.key}>{s.text}</span>
    ),
  );
}

// The snippet area of one Scripture hit. Semantic → plain verse text. Keyword → either a single
// highlighted snippet, or (multi-translation) one labeled, highlighted snippet per matched
// translation: reading-translation first, else Concord's order (which leads with the top-ranked).
function ScriptureSnippet({
  hit,
  readingTranslation,
}: {
  hit: SemanticResult | KeywordResult;
  readingTranslation: string;
}): JSX.Element | null {
  if (!("snippet" in hit)) {
    return hit.text ? <p className="mt-1 font-serif text-gray-700">{hit.text}</p> : null;
  }
  const matches = hit.matches ?? null;
  const ids = matches ? Object.keys(matches) : [];
  if (matches && ids.length >= 2) {
    const ordered = ids.includes(readingTranslation)
      ? [readingTranslation, ...ids.filter((id) => id !== readingTranslation)]
      : ids;
    return (
      <div className="mt-1 flex flex-col gap-1">
        {ordered.map((id, i) => (
          <p
            key={id}
            className={i === 0 ? "font-serif text-gray-700" : "font-serif text-sm text-gray-500"}
          >
            <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 align-middle text-xs font-medium text-gray-600">
              {id}
            </span>
            {highlighted(matches[id] ?? "")}
          </p>
        ))}
      </div>
    );
  }
  return hit.snippet ? (
    <p className="mt-1 font-serif text-gray-700">{highlighted(hit.snippet)}</p>
  ) : null;
}

export function SearchView(): JSX.Element {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  // Which Scripture search to run. Only the active mode's query fires — a keyword search never
  // spins up Concord's heavy embedding model (issue #46).
  const [mode, setMode] = useState<Mode>("semantic");

  // Semantic search ranks in WEB meaning-space but renders in ONE display translation; show it in
  // the reader's translation (the profile's last-used), not a hardcoded default. Shared resolution.
  const readingTranslation = useReadingTranslation();

  // Keyword scope: which translations to search. Empty = ALL (the default). In-memory only —
  // resets on reload, never persisted.
  const [selected, setSelected] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Search scope (#62): what to search — Scripture, your own notes, Concord's study notes. All on
  // by default (today's behavior); unchecking one stops that search and hides its section. Lets a
  // user search Scripture OR the notes OR any mix, and makes the study-notes search discoverable.
  // In-memory, not persisted.
  const [scriptureOn, setScriptureOn] = useState(true);
  const [yourNotesOn, setYourNotesOn] = useState(true);
  const [studyNotesOn, setStudyNotesOn] = useState(true);
  // Semantic mode is meaning-based Scripture only — the scope row and the keyword note searches
  // belong to keyword mode (#66/#67). Selections live in state so they survive the mode toggle.
  const showScripture = mode === "semantic" || scriptureOn;
  const nothingSelected = !scriptureOn && !yourNotesOn && !studyNotesOn;

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const booksById = useMemo(
    () => new Map((booksQuery.data ?? []).map((b) => [b.id, b])),
    [booksQuery.data],
  );
  const translationsQuery = useQuery({ queryKey: ["translations"], queryFn: fetchTranslations });

  const semantic = useQuery({
    queryKey: ["semantic-search", query, readingTranslation],
    queryFn: () => semanticSearch(query, readingTranslation),
    enabled: mode === "semantic" && query.length > 0,
  });
  const keyword = useQuery({
    // The selection is part of the key so narrowing refetches; sorted so order doesn't churn it.
    queryKey: ["keyword-search", query, [...selected].sort().join(",")],
    queryFn: () => keywordSearch(query, selected.length > 0 ? selected : undefined),
    enabled: scriptureOn && mode === "keyword" && query.length > 0,
  });
  const scripture = mode === "semantic" ? semantic : keyword;
  const otherMode: Mode = mode === "keyword" ? "semantic" : "keyword";
  const notes = useQuery({
    queryKey: ["note-search", query],
    queryFn: () => searchAnnotations(query),
    enabled: mode === "keyword" && yourNotesOn && query.length > 0,
  });
  // Concord's translator's/study notes — independent of the Scripture mode/picker, like "Your
  // notes". Its own key (distinct from "note-search"). Best-effort: the backend swallows failures
  // to [], so the section renders only on real hits and never degrades the rest of the page.
  const studyNotes = useQuery({
    queryKey: ["study-notes-search", query],
    queryFn: () => searchStudyNotes(query),
    enabled: mode === "keyword" && studyNotesOn && query.length > 0,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };

  // The active mode's results, widened to the common shape so one list renders either kind; the
  // score is shown only when present (semantic).
  const scriptureResults: Array<SemanticResult | KeywordResult> = scripture.data ?? [];

  return (
    <div className="min-h-screen bg-stone-50">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        {/* Semantic/keyword is the primary search selector — always shown. Semantic = meaning-based
            Scripture only; keyword exposes the scope row + translation picker below. */}
        <div className="mb-3 flex w-full gap-1 rounded-lg bg-gray-100 p-1 sm:w-72" role="tablist">
            {(["semantic", "keyword"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`flex-1 rounded-md px-3 py-1 text-sm font-medium ${
                  mode === m ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "semantic" ? "Semantic" : "Keyword"}
              </button>
            ))}
        </div>

        <form onSubmit={submit} className="mb-3 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              mode === "semantic"
                ? "Search by meaning… e.g. anxiety, the good shepherd"
                : !scriptureOn
                  ? "Search your notes…"
                  : "Search for an exact word or phrase… e.g. living water"
            }
            aria-label="Search query"
            className="flex-1 rounded border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
        </form>

        {/* Search scope (#62) — keyword only. The note searches are keyword-matched, so semantic
            mode (meaning-based Scripture only) hides the whole row; selections return on switch
            back (#66/#67). All on by default; uncheck to exclude a kind. */}
        {mode === "keyword" && (
          <fieldset className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
            <legend className="sr-only">What to search</legend>
            <span className="text-gray-500">Search:</span>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={scriptureOn}
                onChange={(e) => setScriptureOn(e.target.checked)}
              />
              Scripture
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={yourNotesOn}
                onChange={(e) => setYourNotesOn(e.target.checked)}
              />
              Your notes
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={studyNotesOn}
                onChange={(e) => setStudyNotesOn(e.target.checked)}
              />
              Study notes
            </label>
          </fieldset>
        )}

        {/* Translation scope — keyword only. Defaults to all loaded translations; narrow to a
            subset here. In-memory: this resets on reload. (Semantic shows one display translation.) */}
        {scriptureOn && mode === "keyword" && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              aria-expanded={pickerOpen}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Translations:{" "}
              <span className="font-medium text-gray-900">
                {selected.length === 0 ? "All translations" : selected.join(", ")}
              </span>{" "}
              <span aria-hidden="true">▾</span>
            </button>
            {pickerOpen && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-gray-200 bg-white p-3">
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="text-sm text-blue-700 hover:underline"
                >
                  All translations
                </button>
                {(translationsQuery.data ?? []).map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) =>
                        setSelected((cur) =>
                          e.target.checked ? [...cur, t.id] : cur.filter((id) => id !== t.id),
                        )
                      }
                    />
                    {t.id}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {query.length === 0 && (
          <p className="text-gray-500">
            {mode === "semantic"
              ? "Enter a query to search Scripture by meaning."
              : "Enter a query to search Scripture (by exact word or phrase) and your notes."}
          </p>
        )}

        {query.length > 0 && (
          <div className="flex flex-col gap-8">
            {mode === "keyword" && nothingSelected && (
              <p className="text-gray-500">Pick what to search above.</p>
            )}
            {/* Scripture — semantic or keyword search via Concord, per the mode toggle */}
            {showScripture && (
            <section aria-label="Scripture results">
              <h2 className="mb-2 text-lg font-semibold">
                Scripture{" "}
                <span className="text-sm font-normal text-gray-400">
                  ({mode === "semantic" ? "semantic" : "keyword"})
                </span>
              </h2>
              {scripture.isPending && <p className="text-gray-500">Searching…</p>}
              {scripture.isError && (
                <p className="text-red-600">Couldn&rsquo;t search (is Concord reachable?).</p>
              )}
              {scripture.data && scriptureResults.length === 0 && (
                <div className="text-gray-500">
                  <p>No matching verses.</p>
                  {/* A keyword query Concord can't run (FTS5 punctuation) comes back empty; offer the
                      same text in the other mode — semantic doesn't use FTS5 (issue #51). */}
                  <button
                    type="button"
                    onClick={() => setMode(otherMode)}
                    className="mt-1 text-sm text-blue-700 hover:underline"
                  >
                    {mode === "keyword"
                      ? `Search “${query}” by meaning instead →`
                      : `Search “${query}” for the exact phrase instead →`}
                  </button>
                </div>
              )}
              <ul className="flex flex-col gap-3">
                {scriptureResults.map((r) => (
                  <li
                    key={`${r.book}-${r.chapter}-${r.verse}`}
                    className="rounded border border-gray-200 bg-white p-4"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{r.reference}</span>
                      {"score" in r && (
                        <span className="text-xs text-gray-400">score {r.score.toFixed(3)}</span>
                      )}
                      <Link
                        to={`/read?book=${r.book}&chapter=${r.chapter}&verse=${r.verse}`}
                        className="ml-auto text-sm text-blue-700 hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                    <ScriptureSnippet hit={r} readingTranslation={readingTranslation} />
                  </li>
                ))}
              </ul>
            </section>
            )}

            {/* Notes — keyword search (semantic note search awaits a Concord embed endpoint).
                Keyword mode only: a semantic search shows no keyword note results (#67). */}
            {mode === "keyword" && yourNotesOn && (
            <section aria-label="Note results">
              <h2 className="mb-1 text-lg font-semibold">
                Your notes <span className="text-sm font-normal text-gray-400">(keyword)</span>
              </h2>
              <p className="mb-2 text-xs text-gray-400">
                Notes are matched by keyword for now; semantic note search is coming.
              </p>
              {notes.isPending && <p className="text-gray-500">Searching…</p>}
              {notes.isError && <p className="text-red-600">Couldn&rsquo;t search your notes.</p>}
              {notes.data && notes.data.length === 0 && (
                <p className="text-gray-500">No matching notes.</p>
              )}
              <ul className="flex flex-col gap-3">
                {notes.data?.map((a) => (
                  <li key={a.id} className="rounded border border-gray-200 bg-white p-4">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">{noteReference(a, booksById)}</span>
                      <Link
                        to={readerLink(a)}
                        className="ml-auto text-sm text-blue-700 hover:underline"
                      >
                        Open in reader
                      </Link>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{notePreview(a.note_markdown)}</p>
                    {a.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {a.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            )}

            {/* Study notes — Concord's translator's/study notes (best-effort). Renders ONLY on
                real hits: the stock image ships none, so on most deployments this never appears,
                and any failure is already swallowed to [] by the backend. */}
            {mode === "keyword" && studyNotesOn && studyNotes.data && studyNotes.data.length > 0 && (
              <section aria-label="Study notes results">
                <h2 className="mb-2 text-lg font-semibold">
                  Study notes{" "}
                  <span className="text-sm font-normal text-gray-400">(keyword)</span>
                </h2>
                <ul className="flex flex-col gap-3">
                  {studyNotes.data.map((n) => (
                    <li
                      key={`${n.book}-${n.chapter}-${n.verse}-${n.translation}-${n.type ?? ""}`}
                      className="rounded border border-gray-200 bg-white p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{n.reference}</span>
                        <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                          {studyNoteBadge(n.type)}
                        </span>
                        <Link
                          to={`/read?book=${n.book}&chapter=${n.chapter}&verse=${n.verse}`}
                          className="ml-auto text-sm text-blue-700 hover:underline"
                        >
                          Open in reader
                        </Link>
                      </div>
                      {n.snippet && (
                        <p className="mt-1 font-serif text-gray-700">{highlighted(n.snippet)}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
