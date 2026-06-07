import { useQueries, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AnnotationPopover } from "@/components/AnnotationPopover";
import { useAuth } from "@/hooks/useAuth";
import { nextChapter, prevChapter } from "@/lib/navigation";
import { fetchBooks, fetchChapter, fetchTranslations } from "@/lib/reader";
import type { ReadAnnotation, ReadChapter } from "@/schemas";

const DEFAULT_TRANSLATION = "KJV";
const MAX_COLUMNS = 3;

/**
 * Side-by-side translation comparison (issue #40). Reads 1–3 translations of the same book/chapter
 * and aligns them verse-by-verse. Alignment is by CANONICAL verse number (invariant 4): every
 * column's verses carry the same USFM coordinate, so the same address lines up across translations
 * regardless of rendering. This is read-only — annotations show as view-only overlays (amber + a
 * marker), scope-filtered per column by the server, so a note written for one translation appears
 * in that column but is marked out-of-scope (○) in the others. Editing lives in the reader; the
 * popover deep-links there.
 */
export function CompareView(): JSX.Element {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  // Seed location + the first column from a deep link (?translation=&book=&chapter= carried from the
  // reader), else the profile's last position, else first-time defaults — the same priority the
  // reader uses. A distinct second column is added once translations load (see the seed effect).
  const [book, setBook] = useState(() => searchParams.get("book") ?? user?.last_book ?? "JHN");
  const [chapter, setChapter] = useState(() =>
    Number(searchParams.get("chapter") ?? user?.last_chapter ?? 3),
  );
  const [columns, setColumns] = useState<string[]>(() => [
    searchParams.get("translation") ?? user?.last_translation ?? DEFAULT_TRANSLATION,
  ]);
  const [openNote, setOpenNote] = useState<{ annotation: ReadAnnotation; anchor: HTMLElement } | null>(
    null,
  );

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const translationsQuery = useQuery({ queryKey: ["translations"], queryFn: fetchTranslations });
  const books = useMemo(() => booksQuery.data ?? [], [booksQuery.data]);
  const translations = useMemo(() => translationsQuery.data ?? [], [translationsQuery.data]);

  // One column per selected translation, fetched in parallel. The query key matches the reader's,
  // so a chapter already read there is served from cache. Each result carries the server's
  // per-translation annotation overlay (scope already resolved into `in_scope`).
  const chapterResults = useQueries({
    queries: columns.map((code) => ({
      queryKey: ["chapter", code, book, chapter],
      queryFn: () => fetchChapter(code, book, chapter),
    })),
  });

  // Once Concord's translation list is known, heal the seeded columns (drop any it no longer
  // offers) and add a distinct second column so compare opens genuinely side-by-side. Runs once.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || translations.length === 0) return;
    seededRef.current = true;
    const available = translations.map((t) => t.id);
    let cols = columns.filter((c) => available.includes(c));
    if (cols.length === 0) {
      cols = [available.includes(DEFAULT_TRANSLATION) ? DEFAULT_TRANSLATION : available[0]!];
    }
    if (cols.length === 1) {
      const other = available.find((id) => id !== cols[0]);
      if (other) cols = [...cols, other];
    }
    setColumns(cols);
  }, [translations, columns]);

  const selectedBook = useMemo(() => books.find((b) => b.id === book), [books, book]);
  const chapterOptions = useMemo(() => {
    const count = selectedBook?.chapter_count ?? chapter;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [selectedBook, chapter]);

  const navigate = (b: string, c: number) => {
    setBook(b);
    setChapter(c);
    setOpenNote(null);
  };
  const next = nextChapter(books, book, chapter);
  const prev = prevChapter(books, book, chapter);

  const setColumn = (index: number, code: string) => {
    setColumns((cols) => cols.map((c, i) => (i === index ? code : c)));
    setOpenNote(null);
  };
  const removeColumn = (index: number) => {
    setColumns((cols) => (cols.length > 1 ? cols.filter((_, i) => i !== index) : cols));
    setOpenNote(null);
  };
  const addColumn = (code: string) => {
    if (!code) return;
    setColumns((cols) => (cols.length < MAX_COLUMNS ? [...cols, code] : cols));
  };
  const unusedTranslations = translations.filter((t) => !columns.includes(t.id));

  // The union of canonical verse numbers across every loaded column, ascending. A verse a
  // translation lacks renders an em-dash in its cell — an honest gap, never a guessed line.
  const verseNumbers = Array.from(
    new Set(chapterResults.flatMap((r) => (r.data?.verses ?? []).map((v) => v.verse))),
  ).sort((a, b) => a - b);

  const reference =
    chapterResults.find((r) => r.data)?.data?.reference ?? `${book} ${chapter}`;
  const allPending = chapterResults.every((r) => r.isPending);
  const anyError = chapterResults.some((r) => r.isError);

  const verseIn = (data: ReadChapter | undefined, verse: number) =>
    data?.verses.find((v) => v.verse === verse);

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">songbird</h1>
            <span className="text-sm text-gray-400">/ compare</span>
            <Link to="/read" className="text-sm text-blue-700 hover:underline">
              Reader
            </Link>
            <Link to="/" className="text-sm text-blue-700 hover:underline">
              Home
            </Link>
            <Link to="/browse" className="text-sm text-blue-700 hover:underline">
              Browse notes
            </Link>
            <Link to="/search" className="text-sm text-blue-700 hover:underline">
              Search
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-gray-500">Book</span>
              <select
                className="rounded border border-gray-300 px-2 py-1"
                value={book}
                onChange={(e) => navigate(e.target.value, 1)}
                aria-label="Book"
              >
                {(books.length > 0 ? books : [{ id: book, name: book }]).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-gray-500">Chapter</span>
              <select
                className="rounded border border-gray-300 px-2 py-1"
                value={chapter}
                onChange={(e) => navigate(book, Number(e.target.value))}
                aria-label="Chapter"
              >
                {chapterOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-40"
                onClick={() => prev && navigate(prev.book, prev.chapter)}
                disabled={!prev}
                aria-label="Previous chapter"
              >
                ← Prev
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-40"
                onClick={() => next && navigate(next.book, next.chapter)}
                disabled={!next}
                aria-label="Next chapter"
              >
                Next →
              </button>
            </div>
            {columns.length < MAX_COLUMNS && unusedTranslations.length > 0 && (
              <label className="ml-auto flex items-center gap-1">
                <span className="text-gray-500">Add</span>
                <select
                  className="rounded border border-gray-300 px-2 py-1"
                  value=""
                  onChange={(e) => addColumn(e.target.value)}
                  aria-label="Add translation"
                >
                  <option value="">+ translation</option>
                  {unusedTranslations.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:hidden">
          Rotate your device to landscape to compare translations side by side.
        </div>

        <h2 className="mb-4 font-sans text-xl font-semibold">{reference}</h2>

        {allPending && <p className="text-gray-500">Loading chapter…</p>}
        {anyError && (
          <p className="mb-3 text-sm text-red-600">
            Couldn&rsquo;t load one of the translations. Is Concord reachable?
          </p>
        )}

        {!allPending && (
          <div className="overflow-x-auto">
            <div
              className="grid gap-x-4"
              style={{
                gridTemplateColumns: `2.5rem repeat(${columns.length}, minmax(13rem, 1fr))`,
              }}
            >
              {/* Header row: a corner gutter + each column's translation picker and remove button. */}
              <div />
              {columns.map((code, i) => (
                <div
                  key={`head-${i}`}
                  className="flex items-center gap-2 border-b border-gray-200 pb-2"
                >
                  <select
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                    value={code}
                    onChange={(e) => setColumn(i, e.target.value)}
                    aria-label={`Translation column ${i + 1}`}
                  >
                    {(translations.length > 0 ? translations : [{ id: code, name: code }]).map(
                      (t) => (
                        <option key={t.id} value={t.id}>
                          {t.id}
                        </option>
                      ),
                    )}
                  </select>
                  {columns.length > 1 && (
                    <button
                      type="button"
                      className="rounded px-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                      onClick={() => removeColumn(i)}
                      aria-label={`Remove column ${i + 1}`}
                      title="Remove column"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              {/* Verse rows: the canonical verse number, then each translation's rendering of it. */}
              {verseNumbers.map((n) => (
                <Fragment key={n}>
                  <div className="pt-1 text-right font-sans text-xs tabular-nums text-gray-400">
                    {n}
                  </div>
                  {columns.map((code, i) => {
                    const v = verseIn(chapterResults[i]?.data, n);
                    const inScope = v?.annotations.filter((a) => a.in_scope) ?? [];
                    const outScope = v?.annotations.filter((a) => !a.in_scope) ?? [];
                    return (
                      <div
                        key={`v-${n}-${i}`}
                        className={`py-1 font-serif text-base leading-7 ${
                          inScope.length > 0 ? "rounded bg-amber-100 px-1" : ""
                        }`}
                      >
                        {v ? (
                          <>
                            <span>{v.text ?? "—"}</span>
                            {inScope.length > 0 && (
                              <button
                                type="button"
                                className="ml-2 align-middle text-amber-600 hover:text-amber-800"
                                onClick={(e) =>
                                  setOpenNote({ annotation: inScope[0]!, anchor: e.currentTarget })
                                }
                                aria-label={`View note on ${code} ${n}`}
                                title="View note"
                              >
                                ●
                              </button>
                            )}
                            {outScope.length > 0 && (
                              <button
                                type="button"
                                className="ml-2 align-middle text-gray-400 hover:text-gray-600"
                                onClick={(e) =>
                                  setOpenNote({ annotation: outScope[0]!, anchor: e.currentTarget })
                                }
                                aria-label={`View out-of-scope note on ${code} ${n}`}
                                title={`Written for ${outScope[0]!.scope_translations.join(", ")}`}
                              >
                                ○
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </main>

      {openNote && (
        <AnnotationPopover
          annotation={openNote.annotation}
          anchor={openNote.anchor}
          onClose={() => setOpenNote(null)}
        />
      )}
    </div>
  );
}
