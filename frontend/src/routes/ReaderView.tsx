import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { NoteEditor } from "@/components/NoteEditor";
import { SidePanel } from "@/components/SidePanel";
import {
  createAnnotation,
  deleteAnnotation,
  fetchBooks,
  fetchChapter,
  updateAnnotation,
} from "@/lib/reader";
import type { ReadVerse } from "@/schemas";

const DEFAULT_TRANSLATION = "KJV"; // translation switching is Slice 2

interface Editing {
  verse: ReadVerse;
  annotationId: number | null; // null → new annotation
  initialMarkdown: string;
}

export function ReaderView(): JSX.Element {
  const queryClient = useQueryClient();
  const [book, setBook] = useState("JHN");
  const [chapter, setChapter] = useState(3);
  const [editing, setEditing] = useState<Editing | null>(null);

  const translation = DEFAULT_TRANSLATION;

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const chapterQuery = useQuery({
    queryKey: ["chapter", translation, book, chapter],
    queryFn: () => fetchChapter(translation, book, chapter),
  });

  const selectedBook = useMemo(
    () => booksQuery.data?.find((b) => b.id === book),
    [booksQuery.data, book],
  );
  const chapterOptions = useMemo(() => {
    const count = selectedBook?.chapter_count ?? chapter;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [selectedBook, chapter]);

  const invalidateChapter = () =>
    queryClient.invalidateQueries({ queryKey: ["chapter", translation, book, chapter] });

  const saveMutation = useMutation({
    mutationFn: async (markdown: string) => {
      if (!editing) return;
      if (editing.annotationId !== null) {
        await updateAnnotation(editing.annotationId, markdown);
      } else {
        await createAnnotation({
          book_usfm: chapterQuery.data?.book ?? book,
          start_chapter: chapter,
          start_verse: editing.verse.verse,
          end_chapter: chapter,
          end_verse: editing.verse.verse,
          note_markdown: markdown,
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
    setEditing({ verse, annotationId: null, initialMarkdown: "" });
  const openExisting = (verse: ReadVerse) => {
    const first = verse.annotations[0];
    if (!first) return openNew(verse);
    setEditing({ verse, annotationId: first.id, initialMarkdown: first.note_markdown });
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 p-4">
          <h1 className="text-2xl font-bold tracking-tight">songbird</h1>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-gray-500">Book</span>
              <select
                className="rounded border border-gray-300 px-2 py-1"
                value={book}
                onChange={(e) => setBook(e.target.value)}
                aria-label="Book"
              >
                {(booksQuery.data ?? [{ id: book, name: book, chapter_count: null }]).map((b) => (
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
                onChange={(e) => setChapter(Number(e.target.value))}
                aria-label="Chapter"
              >
                {chapterOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">{translation}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {chapterQuery.isPending && <p className="text-gray-500">Loading chapter…</p>}
        {chapterQuery.isError && (
          <p className="text-red-600">
            Couldn&rsquo;t load this chapter. Is Concord reachable?
          </p>
        )}
        {chapterQuery.data && (
          <article className="font-serif text-lg leading-8">
            <h2 className="mb-4 font-sans text-xl font-semibold">{chapterQuery.data.reference}</h2>
            {chapterQuery.data.verses.map((v) => {
              const annotated = v.annotations.length > 0;
              return (
                <p
                  key={v.verse}
                  className={`group relative -mx-3 rounded px-3 py-0.5 ${
                    annotated ? "bg-amber-100" : ""
                  }`}
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
                  {annotated && (
                    <button
                      type="button"
                      className="ml-2 align-middle text-amber-600 hover:text-amber-800"
                      onClick={() => openExisting(v)}
                      aria-label={`View note on verse ${v.verse}`}
                      title="View note"
                    >
                      ●
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
        onClose={() => setEditing(null)}
      >
        {editing && (
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
        )}
      </SidePanel>
    </div>
  );
}
