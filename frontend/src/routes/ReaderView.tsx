import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { NoteEditor } from "@/components/NoteEditor";
import { ScopePicker } from "@/components/ScopePicker";
import { SidePanel } from "@/components/SidePanel";
import { ApiError } from "@/lib/api";
import { nextChapter, prevChapter } from "@/lib/navigation";
import {
  createAnnotation,
  deleteAnnotation,
  fetchBooks,
  fetchChapter,
  fetchTranslations,
  resolveReference,
  updateAnnotation,
} from "@/lib/reader";
import type { ReadAnnotation, ReadVerse, Scope } from "@/schemas";

const DEFAULT_TRANSLATION = "KJV";

interface Editing {
  verse: ReadVerse;
  annotationId: number | null; // null → new annotation
  initialMarkdown: string;
  scope: Scope;
  scopeLabel: string | null; // "written for KJV" when out-of-scope for the current translation
}

export function ReaderView(): JSX.Element {
  const queryClient = useQueryClient();
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [book, setBook] = useState("JHN");
  const [chapter, setChapter] = useState(3);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [refInput, setRefInput] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [highlightVerse, setHighlightVerse] = useState<number | null>(null);

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const translationsQuery = useQuery({ queryKey: ["translations"], queryFn: fetchTranslations });
  const chapterQuery = useQuery({
    queryKey: ["chapter", translation, book, chapter],
    queryFn: () => fetchChapter(translation, book, chapter),
  });

  const translations = useMemo(() => translationsQuery.data ?? [], [translationsQuery.data]);
  const books = useMemo(() => booksQuery.data ?? [], [booksQuery.data]);

  const selectedBook = useMemo(() => books.find((b) => b.id === book), [books, book]);
  const chapterOptions = useMemo(() => {
    const count = selectedBook?.chapter_count ?? chapter;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [selectedBook, chapter]);

  // Navigate the reader. A verse (from a single-verse jump) is scrolled-to + briefly highlit.
  const navigate = (b: string, c: number, verse: number | null = null) => {
    setBook(b);
    setChapter(c);
    setHighlightVerse(verse);
    setResolveError(null);
  };

  const next = nextChapter(books, book, chapter);
  const prev = prevChapter(books, book, chapter);

  const resolveMutation = useMutation({
    mutationFn: (ref: string) => resolveReference(ref),
    onSuccess: (r) => {
      navigate(r.book, r.chapter, r.verse);
      setRefInput("");
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : "";
      setResolveError(
        code === "NOT_FOUND"
          ? "Couldn't find that reference."
          : "Couldn't resolve that reference (is Concord reachable?).",
      );
    },
  });

  const submitRef = (e: FormEvent) => {
    e.preventDefault();
    const ref = refInput.trim();
    if (ref) resolveMutation.mutate(ref);
  };

  // Scroll to / briefly highlight a jumped-to verse once the chapter has rendered.
  useEffect(() => {
    if (highlightVerse === null || !chapterQuery.data) return;
    const el = document.getElementById(`v-${highlightVerse}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = setTimeout(() => setHighlightVerse(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightVerse, chapterQuery.data]);

  const invalidateChapter = () =>
    queryClient.invalidateQueries({ queryKey: ["chapter", translation, book, chapter] });

  const saveMutation = useMutation({
    mutationFn: async (markdown: string) => {
      if (!editing) return;
      if (editing.annotationId !== null) {
        await updateAnnotation(editing.annotationId, {
          note_markdown: markdown,
          scope_type: editing.scope.type,
          translations: editing.scope.translations,
        });
      } else {
        await createAnnotation({
          book_usfm: chapterQuery.data?.book ?? book,
          start_chapter: chapter,
          start_verse: editing.verse.verse,
          end_chapter: chapter,
          end_verse: editing.verse.verse,
          note_markdown: markdown,
          scope_type: editing.scope.type,
          translations: editing.scope.translations,
        });
      }
    },
    onSuccess: async () => {
      await invalidateChapter();
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await deleteAnnotation(id);
    },
    onSuccess: async () => {
      await invalidateChapter();
      setEditing(null);
    },
  });

  const openNew = (verse: ReadVerse) =>
    setEditing({
      verse,
      annotationId: null,
      initialMarkdown: "",
      scope: { type: "all", translations: [] },
      scopeLabel: null,
    });

  const openExisting = (verse: ReadVerse, annotation: ReadAnnotation) =>
    setEditing({
      verse,
      annotationId: annotation.id,
      initialMarkdown: annotation.note_markdown,
      scope: {
        type: annotation.scope_type as Scope["type"],
        translations: annotation.scope_translations,
      },
      scopeLabel: annotation.in_scope
        ? null
        : `written for ${annotation.scope_translations.join(", ")}`,
    });

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">songbird</h1>
            <div className="ml-auto flex items-center gap-2 text-sm">
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
              <label className="flex items-center gap-1">
                <span className="text-gray-500">Translation</span>
                <select
                  className="rounded border border-gray-300 px-2 py-1"
                  value={translation}
                  onChange={(e) => setTranslation(e.target.value)}
                  aria-label="Translation"
                >
                  {(translations.length > 0
                    ? translations
                    : [{ id: translation, name: translation }]
                  ).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={submitRef} className="flex items-center gap-2">
              <input
                type="text"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
                placeholder="Jump to… e.g. John 3, Gen 1:1"
                aria-label="Jump to reference"
                className="w-56 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={resolveMutation.isPending}
              >
                Go
              </button>
              {resolveError && <span className="text-sm text-red-600">{resolveError}</span>}
            </form>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
                onClick={() => prev && navigate(prev.book, prev.chapter)}
                disabled={!prev}
                aria-label="Previous chapter"
              >
                ← Prev
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
                onClick={() => next && navigate(next.book, next.chapter)}
                disabled={!next}
                aria-label="Next chapter"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {chapterQuery.isPending && <p className="text-gray-500">Loading chapter…</p>}
        {chapterQuery.isError && (
          <p className="text-red-600">Couldn&rsquo;t load this chapter. Is Concord reachable?</p>
        )}
        {chapterQuery.data && (
          <article className="font-serif text-lg leading-8">
            <h2 className="mb-4 font-sans text-xl font-semibold">{chapterQuery.data.reference}</h2>
            {chapterQuery.data.verses.map((v) => {
              const inScope = v.annotations.filter((a) => a.in_scope);
              const outScope = v.annotations.filter((a) => !a.in_scope);
              return (
                <p
                  key={v.verse}
                  id={`v-${v.verse}`}
                  className={`group relative -mx-3 rounded px-3 py-0.5 ${
                    inScope.length > 0 ? "bg-amber-100" : ""
                  } ${highlightVerse === v.verse ? "ring-2 ring-blue-400" : ""}`}
                >
                  <button
                    type="button"
                    className="mr-1 align-super text-xs font-sans font-semibold text-blue-700 hover:underline"
                    onClick={() => openNew(v)}
                    aria-label={`Annotate verse ${v.verse}`}
                  >
                    {v.verse}
                  </button>
                  <span>{v.text}</span>
                  {inScope.length > 0 && (
                    <button
                      type="button"
                      className="ml-2 align-middle text-amber-600 hover:text-amber-800"
                      onClick={() => openExisting(v, inScope[0]!)}
                      aria-label={`View note on verse ${v.verse}`}
                      title="View note"
                    >
                      ●
                    </button>
                  )}
                  {outScope.length > 0 && (
                    <button
                      type="button"
                      className="ml-2 align-middle text-gray-400 hover:text-gray-600"
                      onClick={() => openExisting(v, outScope[0]!)}
                      aria-label={`View out-of-scope note on verse ${v.verse}`}
                      title={`Written for ${outScope[0]!.scope_translations.join(", ")}`}
                    >
                      ○
                    </button>
                  )}
                </p>
              );
            })}
          </article>
        )}
      </main>

      <SidePanel
        open={editing !== null}
        title={editing ? `Note on ${editing.verse.reference}` : ""}
        subtitle={editing?.verse.text}
        scopeLabel={editing?.scopeLabel}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <ScopePicker
              value={editing.scope}
              currentTranslation={translation}
              availableTranslations={translations}
              onChange={(scope) => setEditing({ ...editing, scope })}
            />
            <NoteEditor
              key={`${editing.verse.verse}-${editing.annotationId ?? "new"}`}
              initialMarkdown={editing.initialMarkdown}
              saving={saveMutation.isPending}
              onSave={(markdown) => saveMutation.mutate(markdown)}
              onCancel={() => setEditing(null)}
              onDelete={
                editing.annotationId !== null
                  ? () => deleteMutation.mutate(editing.annotationId as number)
                  : undefined
              }
            />
          </div>
        )}
      </SidePanel>
    </div>
  );
}
