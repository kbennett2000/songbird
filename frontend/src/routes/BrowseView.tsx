import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { browseAnnotations, fetchBooks, fetchTags } from "@/lib/reader";
import type { Annotation, Book } from "@/schemas";

function notePreview(markdown: string): string {
  // Strip the lightest Markdown noise for a one-line preview.
  const plain = markdown
    .replace(/[#*_`>-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

function reference(a: Annotation, booksById: Map<string, Book>): string {
  // Concord-free: the friendly book name comes from the already-fetched books list; if it's
  // not loaded we fall back to the USFM code songbird stores.
  const name = booksById.get(a.book_usfm)?.name ?? a.book_usfm;
  const span =
    a.start_chapter === a.end_chapter && a.start_verse === a.end_verse
      ? `${a.start_chapter}:${a.start_verse}`
      : `${a.start_chapter}:${a.start_verse}–${a.end_chapter}:${a.end_verse}`;
  return `${name} ${span}`;
}

export function BrowseView(): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);

  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const annotationsQuery = useQuery({
    queryKey: ["browse", selected],
    queryFn: () => browseAnnotations(selected, "all"),
  });

  const booksById = useMemo(
    () => new Map((booksQuery.data ?? []).map((b) => [b.id, b])),
    [booksQuery.data],
  );

  const toggle = (tag: string) =>
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 p-4">
          <h1 className="text-2xl font-bold tracking-tight">Browse notes</h1>
          <Link to="/" className="ml-auto text-sm text-blue-700 hover:underline">
            ← Reader
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        <section aria-label="Tag filter" className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Filter by tag (all selected)</h2>
          <div className="flex flex-wrap gap-2">
            {(tagsQuery.data ?? []).length === 0 && (
              <span className="text-sm text-gray-400">No tags yet.</span>
            )}
            {(tagsQuery.data ?? []).map((tag) => {
              const on = selected.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    on
                      ? "bg-blue-600 text-white"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>

        {annotationsQuery.isPending && <p className="text-gray-500">Loading…</p>}
        {annotationsQuery.data && annotationsQuery.data.length === 0 && (
          <p className="text-gray-500">No notes match.</p>
        )}
        <ul className="flex flex-col gap-3">
          {annotationsQuery.data?.map((a) => (
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
      </main>
    </div>
  );
}
