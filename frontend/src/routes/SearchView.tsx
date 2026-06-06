import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchBooks, searchAnnotations, semanticSearch } from "@/lib/reader";
import type { Annotation, Book } from "@/schemas";

const SEARCH_TRANSLATION = "KJV"; // the translation results are shown in (first cut)

function notePreview(markdown: string): string {
  const plain = markdown
    .replace(/[#*_`>-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

function reference(a: Annotation, booksById: Map<string, Book>): string {
  const name = booksById.get(a.book_usfm)?.name ?? a.book_usfm;
  return `${name} ${a.start_chapter}:${a.start_verse}`;
}

export function SearchView(): JSX.Element {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const booksById = useMemo(
    () => new Map((booksQuery.data ?? []).map((b) => [b.id, b])),
    [booksQuery.data],
  );

  const scripture = useQuery({
    queryKey: ["semantic-search", query],
    queryFn: () => semanticSearch(query, SEARCH_TRANSLATION),
    enabled: query.length > 0,
  });
  const notes = useQuery({
    queryKey: ["note-search", query],
    queryFn: () => searchAnnotations(query),
    enabled: query.length > 0,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft.trim());
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 p-4">
          <h1 className="text-2xl font-bold tracking-tight">Search</h1>
          <Link to="/" className="ml-auto text-sm text-blue-700 hover:underline">
            ← Reader
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        <form onSubmit={submit} className="mb-6 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by meaning… e.g. anxiety, the good shepherd"
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

        {query.length === 0 && (
          <p className="text-gray-500">Enter a query to search Scripture (by meaning) and your notes.</p>
        )}

        {query.length > 0 && (
          <div className="flex flex-col gap-8">
            {/* Scripture — semantic search via Concord */}
            <section aria-label="Scripture results">
              <h2 className="mb-2 text-lg font-semibold">
                Scripture <span className="text-sm font-normal text-gray-400">(semantic)</span>
              </h2>
              {scripture.isPending && <p className="text-gray-500">Searching…</p>}
              {scripture.isError && (
                <p className="text-red-600">Couldn&rsquo;t search (is Concord reachable?).</p>
              )}
              {scripture.data && scripture.data.length === 0 && (
                <p className="text-gray-500">No matching verses.</p>
              )}
              <ul className="flex flex-col gap-3">
                {scripture.data?.map((r) => (
                  <li
                    key={`${r.book}-${r.chapter}-${r.verse}`}
                    className="rounded border border-gray-200 bg-white p-4"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{r.reference}</span>
                      <span className="text-xs text-gray-400">score {r.score.toFixed(3)}</span>
                      <Link
                        to={`/?book=${r.book}&chapter=${r.chapter}&verse=${r.verse}`}
                        className="ml-auto text-sm text-blue-700 hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                    {r.text && <p className="mt-1 font-serif text-gray-700">{r.text}</p>}
                  </li>
                ))}
              </ul>
            </section>

            {/* Notes — keyword search (semantic note search awaits a Concord embed endpoint) */}
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
                      <span className="font-semibold">{reference(a, booksById)}</span>
                      <Link
                        to={`/?book=${a.book_usfm}&chapter=${a.start_chapter}&verse=${a.start_verse}`}
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
          </div>
        )}
      </main>
    </div>
  );
}
