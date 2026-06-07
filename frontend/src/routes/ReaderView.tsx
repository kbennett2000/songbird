import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CrossReferences } from "@/components/CrossReferences";
import { Geography } from "@/components/Geography";
import { MapView } from "@/components/MapView";
import { Modal } from "@/components/Modal";
import { NoteEditor } from "@/components/NoteEditor";
import { NotePopover } from "@/components/NotePopover";
import { ScopePicker } from "@/components/ScopePicker";
import { SermonNotePopover } from "@/components/SermonNotePopover";
import { SidePanel } from "@/components/SidePanel";
import { TagInput } from "@/components/TagInput";
import { VerseText } from "@/components/VerseText";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { nextChapter, prevChapter } from "@/lib/navigation";
import {
  createAnnotation,
  deleteAnnotation,
  fetchBooks,
  fetchChapter,
  fetchNotes,
  fetchPlaces,
  fetchTags,
  fetchTranslations,
  resolveReference,
  updateAnnotation,
} from "@/lib/reader";
import type { ReadAnnotation, ReadVerse, Scope, SermonNote, TranslatorNote } from "@/schemas";

const DEFAULT_TRANSLATION = "KJV";

interface Editing {
  verse: ReadVerse;
  annotationId: number | null; // null → new annotation
  initialMarkdown: string;
  scope: Scope;
  scopeLabel: string | null; // "written for KJV" when out-of-scope for the current translation
  tags: string[];
}

interface XrefView {
  book: string;
  chapter: number;
  verse: number;
  reference: string;
}

export function ReaderView(): JSX.Element {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  // A jump-from-browse arrives as ?book=&chapter=&verse=; seed the initial location from it.
  const [searchParams] = useSearchParams();
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [book, setBook] = useState(() => searchParams.get("book") ?? "JHN");
  const [chapter, setChapter] = useState(() => Number(searchParams.get("chapter") ?? 3));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [xref, setXref] = useState<XrefView | null>(null);
  const [geo, setGeo] = useState(false);
  const [map, setMap] = useState(false);
  // The translator's note whose popover is open, with the marker it's anchored to.
  const [openNote, setOpenNote] = useState<{ note: TranslatorNote; anchor: HTMLElement } | null>(
    null,
  );
  // The sermon note whose popover is open (separate system — canonical, all-translations).
  const [openSermon, setOpenSermon] = useState<{ note: SermonNote; anchor: HTMLElement } | null>(
    null,
  );
  const [refInput, setRefInput] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [highlightVerse, setHighlightVerse] = useState<number | null>(() => {
    const v = searchParams.get("verse");
    return v ? Number(v) : null;
  });

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const translationsQuery = useQuery({ queryKey: ["translations"], queryFn: fetchTranslations });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const chapterQuery = useQuery({
    queryKey: ["chapter", translation, book, chapter],
    queryFn: () => fetchChapter(translation, book, chapter),
  });
  // The canonical book for this chapter (Concord's USFM code), used for places + the map.
  const chapterBook = chapterQuery.data?.book ?? book;
  // Reuse the per-chapter places fetch (shared cache with the list + the map) to decide whether
  // the globe is enabled: it lights up only when ≥1 place actually has coordinates to plot.
  const placesQuery = useQuery({
    queryKey: ["places", chapterBook, chapter],
    queryFn: () => fetchPlaces(chapterBook, chapter),
  });
  const hasMappable = (placesQuery.data ?? []).some(
    (p) => p.latitude !== null && p.longitude !== null,
  );
  // Translator's notes for the chapter, in the CURRENT translation (NET's tn/sn/tc/map). The key
  // includes `translation`, so switching away from NET refetches → empty → markers clear, while
  // the canonical annotations (from chapterQuery) are untouched. Notes overlay verse text only;
  // an unreachable Concord surfaces a small notice without blocking the already-loaded chapter.
  const notesQuery = useQuery({
    queryKey: ["notes", translation, chapterBook, chapter],
    queryFn: () => fetchNotes(translation, chapterBook, chapter),
  });
  const notesByVerse = useMemo(() => {
    const map = new Map<number, TranslatorNote[]>();
    for (const note of notesQuery.data ?? []) {
      const list = map.get(note.verse);
      if (list) list.push(note);
      else map.set(note.verse, [note]);
    }
    return map;
  }, [notesQuery.data]);

  const translations = useMemo(() => translationsQuery.data ?? [], [translationsQuery.data]);
  const books = useMemo(() => booksQuery.data ?? [], [booksQuery.data]);

  const selectedBook = useMemo(() => books.find((b) => b.id === book), [books, book]);
  const chapterOptions = useMemo(() => {
    const count = selectedBook?.chapter_count ?? chapter;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [selectedBook, chapter]);

  // Navigate the reader. A verse (from a single-verse jump or a cross-ref) is scrolled-to +
  // briefly highlit. Closes any open panel.
  const navigate = (b: string, c: number, verse: number | null = null) => {
    setBook(b);
    setChapter(c);
    setHighlightVerse(verse);
    setResolveError(null);
    setEditing(null);
    setXref(null);
    setGeo(false);
    setMap(false);
    setOpenNote(null);
    setOpenSermon(null);
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
          tags: editing.tags,
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
          tags: editing.tags,
        });
      }
    },
    onSuccess: async () => {
      await invalidateChapter();
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
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

  const openNew = (verse: ReadVerse) => {
    setXref(null);
    setGeo(false);
    setMap(false);
    setEditing({
      verse,
      annotationId: null,
      initialMarkdown: "",
      scope: { type: "all", translations: [] },
      scopeLabel: null,
      tags: [],
    });
  };

  const openExisting = (verse: ReadVerse, annotation: ReadAnnotation) => {
    setXref(null);
    setGeo(false);
    setMap(false);
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
      tags: annotation.tags,
    });
  };

  const openXref = (verse: ReadVerse) => {
    setEditing(null);
    setGeo(false);
    setMap(false);
    setXref({
      book: chapterQuery.data?.book ?? book,
      chapter,
      verse: verse.verse,
      reference: verse.reference,
    });
  };

  const openGeo = () => {
    setEditing(null);
    setXref(null);
    setMap(false);
    setGeo(true);
  };

  const openMap = () => {
    setEditing(null);
    setXref(null);
    setGeo(false);
    setMap(true);
  };

  const closePanel = () => {
    setEditing(null);
    setXref(null);
    setGeo(false);
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">songbird</h1>
            <Link to="/browse" className="text-sm text-blue-700 hover:underline">
              Browse notes
            </Link>
            <Link to="/search" className="text-sm text-blue-700 hover:underline">
              Search
            </Link>
            {user && (
              <span className="flex items-center gap-2 text-sm text-gray-500">
                <span title={user.is_admin ? "Admin" : undefined}>{user.username}</span>
                <button
                  type="button"
                  className="text-blue-700 hover:underline"
                  onClick={() => void logout()}
                >
                  Log out
                </button>
              </span>
            )}
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
                  onChange={(e) => {
                    // Notes are translation-specific; close any open note popover whose marker is
                    // about to be refetched away (the canonical annotation overlay is untouched).
                    setOpenNote(null);
                    setTranslation(e.target.value);
                  }}
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
            <div className="mb-4 flex items-center gap-3">
              <h2 className="font-sans text-xl font-semibold">{chapterQuery.data.reference}</h2>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-0.5 font-sans text-xs text-gray-600 hover:bg-gray-100"
                onClick={openGeo}
              >
                Places in this chapter
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-0.5 font-sans text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
                onClick={openMap}
                disabled={!hasMappable}
                aria-label="Show map"
                title={hasMappable ? "Show map" : "No mapped locations in this passage"}
              >
                🌐 Map
              </button>
            </div>
            {notesQuery.isError && (
              <p className="mb-3 font-sans text-sm text-red-600">
                Translator&rsquo;s notes unavailable (is Concord reachable?).
              </p>
            )}
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
                  <VerseText
                    text={v.text ?? ""}
                    notes={notesByVerse.get(v.verse) ?? []}
                    onOpenNote={(note, anchor) => setOpenNote({ note, anchor })}
                  />
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
                  {v.sermon_notes.length > 0 && (
                    <button
                      type="button"
                      className="ml-2 align-middle text-emerald-600 hover:text-emerald-800"
                      onClick={(e) =>
                        setOpenSermon({ note: v.sermon_notes[0]!, anchor: e.currentTarget })
                      }
                      aria-label={`Sermon on verse ${v.verse}`}
                      title="Sermon"
                    >
                      ▶
                    </button>
                  )}
                  <button
                    type="button"
                    className="ml-2 align-middle text-xs text-gray-300 opacity-0 transition hover:text-blue-600 group-hover:opacity-100"
                    onClick={() => openXref(v)}
                    aria-label={`Cross-references for verse ${v.verse}`}
                    title="Cross-references"
                  >
                    ⇄
                  </button>
                </p>
              );
            })}
          </article>
        )}
      </main>

      <SidePanel
        open={editing !== null || xref !== null || geo}
        title={
          editing
            ? `Note on ${editing.verse.reference}`
            : xref
              ? `Cross-references — ${xref.reference}`
              : geo
                ? `Places — ${chapterQuery.data?.reference ?? ""}`
                : ""
        }
        subtitle={editing?.verse.text}
        scopeLabel={editing?.scopeLabel}
        onClose={closePanel}
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <ScopePicker
              value={editing.scope}
              currentTranslation={translation}
              availableTranslations={translations}
              onChange={(scope) => setEditing({ ...editing, scope })}
            />
            <TagInput
              value={editing.tags}
              suggestions={tagsQuery.data ?? []}
              onChange={(tags) => setEditing({ ...editing, tags })}
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
        {xref && (
          <CrossReferences
            book={xref.book}
            chapter={xref.chapter}
            verse={xref.verse}
            translation={translation}
            onJump={(b, c, v) => navigate(b, c, v)}
          />
        )}
        {geo && (
          <Geography
            book={chapterBook}
            chapter={chapter}
            onJump={(b, c, v) => navigate(b, c, v)}
          />
        )}
      </SidePanel>

      <Modal
        open={map}
        title={`Map — ${chapterQuery.data?.reference ?? ""}`}
        onClose={() => setMap(false)}
      >
        <MapView book={chapterBook} chapter={chapter} onJump={(b, c, v) => navigate(b, c, v)} />
      </Modal>

      {openNote && (
        <NotePopover
          note={openNote.note}
          anchor={openNote.anchor}
          onClose={() => setOpenNote(null)}
          onJump={(b, c, v) => navigate(b, c, v)}
        />
      )}

      {openSermon && (
        <SermonNotePopover
          note={openSermon.note}
          anchor={openSermon.anchor}
          onClose={() => setOpenSermon(null)}
        />
      )}
    </div>
  );
}
