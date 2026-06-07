import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CrossReferences } from "@/components/CrossReferences";
import { Geography } from "@/components/Geography";
import { MapView } from "@/components/MapView";
import { Modal } from "@/components/Modal";
import { NoteEditor } from "@/components/NoteEditor";
import { NotePopover } from "@/components/NotePopover";
import { ScopePicker } from "@/components/ScopePicker";
import { SermonNoteForm, type SermonNoteFormValues } from "@/components/SermonNoteForm";
import { SermonNotePopover } from "@/components/SermonNotePopover";
import { SermonNotesPopover } from "@/components/SermonNotesPopover";
import { SidePanel } from "@/components/SidePanel";
import { TagInput } from "@/components/TagInput";
import { VerseText } from "@/components/VerseText";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { saveReadingPosition } from "@/lib/auth";
import { nextChapter, prevChapter } from "@/lib/navigation";
import {
  createAnnotation,
  createSermonNote,
  deleteAnnotation,
  deleteSermonNote,
  fetchBooks,
  fetchChapter,
  fetchNotes,
  fetchPlaces,
  fetchTags,
  fetchTranslations,
  resolveReference,
  updateAnnotation,
  updateSermonNote,
} from "@/lib/reader";
import type { ReadAnnotation, ReadVerse, Scope, SermonNote, TranslatorNote } from "@/schemas";

const DEFAULT_TRANSLATION = "KJV";

type NoteKind = "annotation" | "sermon";

interface Editing {
  verse: ReadVerse;
  kind: NoteKind;
  // Annotation fields (kind === "annotation")
  annotationId: number | null; // null → new annotation
  initialMarkdown: string;
  scope: Scope;
  scopeLabel: string | null; // "written for KJV" when out-of-scope for the current translation
  tags: string[];
  // Sermon fields (kind === "sermon")
  sermonId: number | null; // null → new sermon note
  sermon: SermonNoteFormValues;
}

const EMPTY_SERMON: SermonNoteFormValues = {
  title: "",
  sermon_url: "",
  reference: "",
  event_date: null,
};

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
  // Reopen to where this profile last read (RequireAuth guarantees `user` is loaded by the time
  // the reader mounts). Priority: an explicit deep link (?book=&chapter= from Browse) wins, then
  // the saved position, then the first-time defaults.
  const [translation, setTranslation] = useState(() => user?.last_translation ?? DEFAULT_TRANSLATION);
  const [book, setBook] = useState(() => searchParams.get("book") ?? user?.last_book ?? "JHN");
  const [chapter, setChapter] = useState(() =>
    Number(searchParams.get("chapter") ?? user?.last_chapter ?? 3),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [xref, setXref] = useState<XrefView | null>(null);
  const [geo, setGeo] = useState(false);
  const [map, setMap] = useState(false);
  // The translator's note whose popover is open, with the marker it's anchored to.
  const [openNote, setOpenNote] = useState<{ note: TranslatorNote; anchor: HTMLElement } | null>(
    null,
  );
  // The sermon notes covering the tapped verse, whose popover is open (separate system —
  // canonical, all-translations). One note → single popover; several → a stacked list.
  const [openSermon, setOpenSermon] = useState<{
    notes: SermonNote[];
    anchor: HTMLElement;
    verse: ReadVerse;
  } | null>(null);
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

  const changeTranslation = (code: string) => {
    // Notes are translation-specific; close any open note popover whose marker is about to be
    // refetched away (the canonical annotation overlay is untouched). Persistence is handled by
    // the reading-position effect below, which covers every navigation path.
    setOpenNote(null);
    setTranslation(code);
  };

  // Persist the full reading position (translation + book + chapter) on the profile whenever it
  // changes, so the reader reopens here next time. One effect covers every navigation path —
  // translation/book/chapter selects, prev/next, jump, and the xref/geo/map jumps. Debounced and
  // last-write-wins so a burst of prev/next collapses to a single PATCH; fire-and-forget so a
  // failed save (e.g. a network blip) never disrupts reading.
  const savedPositionRef = useRef({
    translation: user?.last_translation ?? null,
    book: user?.last_book ?? null,
    chapter: user?.last_chapter ?? null,
  });
  useEffect(() => {
    const saved = savedPositionRef.current;
    // Skip the mount-time run while the reader still sits on the stored position (no redundant
    // write); also makes StrictMode's double-invoke a no-op. A deep link or a self-heal that
    // differs from storage does persist.
    if (saved.translation === translation && saved.book === book && saved.chapter === chapter) {
      return;
    }
    const handle = setTimeout(() => {
      savedPositionRef.current = { translation, book, chapter };
      saveReadingPosition({ translation, book, chapter })
        .then((updated) => queryClient.setQueryData(["auth", "me"], updated))
        .catch(() => {
          // Best-effort: restore the ref so a later identical change retries the save.
          savedPositionRef.current = saved;
        });
    }, 600);
    return () => clearTimeout(handle);
  }, [translation, book, chapter, queryClient]);

  // If the stored default is a code Concord no longer offers, fall back so the reader isn't stuck
  // fetching a missing translation.
  useEffect(() => {
    if (translations.length > 0 && !translations.some((t) => t.id === translation)) {
      setTranslation(DEFAULT_TRANSLATION);
    }
  }, [translations, translation]);

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

  // Self-heal a stale *stored* position once Concord's book list is known: if the initial book is
  // one Concord no longer lists, reset to the default; if the initial chapter overruns the book,
  // clamp it. Runs once (on first book-list availability) so it heals the loaded position without
  // ever second-guessing later navigation — a jump always targets a real Concord book/chapter.
  const healedRef = useRef(false);
  useEffect(() => {
    if (healedRef.current || books.length === 0) return;
    healedRef.current = true;
    const current = books.find((b) => b.id === book);
    if (!current) {
      setBook("JHN");
      setChapter(3);
    } else if (current.chapter_count !== null && chapter > current.chapter_count) {
      setChapter(current.chapter_count);
    }
  }, [books, book, chapter]);

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

  const sermonSaveMutation = useMutation({
    mutationFn: async (values: SermonNoteFormValues) => {
      if (!editing) return;
      if (editing.sermonId !== null) {
        await updateSermonNote(editing.sermonId, {
          title: values.title,
          sermon_url: values.sermon_url,
          reference: values.reference,
          event_date: values.event_date,
          tags: editing.tags,
        });
      } else {
        await createSermonNote({
          title: values.title,
          sermon_url: values.sermon_url,
          reference: values.reference,
          book_usfm: chapterQuery.data?.book ?? book,
          start_chapter: chapter,
          start_verse: editing.verse.verse,
          end_chapter: chapter,
          end_verse: editing.verse.verse,
          event_date: values.event_date,
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

  const sermonDeleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await deleteSermonNote(id);
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
      kind: "annotation",
      annotationId: null,
      initialMarkdown: "",
      scope: { type: "all", translations: [] },
      scopeLabel: null,
      tags: [],
      sermonId: null,
      // Default the sermon reference to the clicked verse (the user can refine it).
      sermon: { ...EMPTY_SERMON, reference: verse.reference },
    });
  };

  const openExisting = (verse: ReadVerse, annotation: ReadAnnotation) => {
    setXref(null);
    setGeo(false);
    setMap(false);
    setEditing({
      verse,
      kind: "annotation",
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
      sermonId: null,
      sermon: { ...EMPTY_SERMON, reference: verse.reference },
    });
  };

  const openSermonEdit = (verse: ReadVerse, note: SermonNote) => {
    setOpenSermon(null);
    setXref(null);
    setGeo(false);
    setMap(false);
    setEditing({
      verse,
      kind: "sermon",
      annotationId: null,
      initialMarkdown: "",
      scope: { type: "all", translations: [] },
      scopeLabel: null,
      tags: note.tags,
      sermonId: note.id,
      sermon: {
        title: note.title,
        sermon_url: note.sermon_url,
        reference: note.reference,
        event_date: note.event_date,
      },
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
            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
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
                  onChange={(e) => changeTranslation(e.target.value)}
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
            <form onSubmit={submitRef} className="flex w-full items-center gap-2 sm:w-auto">
              <input
                type="text"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
                placeholder="Jump to… e.g. John 3, Gen 1:1"
                aria-label="Jump to reference"
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm sm:w-56 sm:flex-none"
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
                        setOpenSermon({
                          notes: v.sermon_notes,
                          anchor: e.currentTarget,
                          verse: v,
                        })
                      }
                      aria-label={
                        v.sermon_notes.length === 1
                          ? `Sermon on verse ${v.verse}`
                          : `${v.sermon_notes.length} sermons on verse ${v.verse}`
                      }
                      title={v.sermon_notes.length === 1 ? "Sermon" : "Sermons"}
                    >
                      ▶
                      {v.sermon_notes.length > 1 && (
                        <span className="ml-0.5 rounded-full bg-emerald-100 px-1 text-[0.7em] font-semibold text-emerald-700">
                          {v.sermon_notes.length}
                        </span>
                      )}
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
            ? editing.kind === "sermon"
              ? `${editing.sermonId !== null ? "Edit sermon" : "Sermon"} on ${editing.verse.reference}`
              : `Note on ${editing.verse.reference}`
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
            {/* Type toggle — only for a brand-new note (an existing note's kind is fixed). */}
            {editing.annotationId === null && editing.sermonId === null && (
              <div className="flex gap-1 rounded-lg bg-gray-100 p-1" role="tablist">
                {(["annotation", "sermon"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={editing.kind === k}
                    className={`flex-1 rounded-md px-3 py-1 text-sm font-medium ${
                      editing.kind === k
                        ? "bg-white text-gray-900 shadow"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => setEditing({ ...editing, kind: k })}
                  >
                    {k === "annotation" ? "Standard" : "Sermon"}
                  </button>
                ))}
              </div>
            )}

            {editing.kind === "annotation" ? (
              <>
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
              </>
            ) : (
              <>
                <TagInput
                  value={editing.tags}
                  suggestions={tagsQuery.data ?? []}
                  onChange={(tags) => setEditing({ ...editing, tags })}
                />
                <SermonNoteForm
                  key={`sermon-${editing.verse.verse}-${editing.sermonId ?? "new"}`}
                  initial={editing.sermon}
                  saving={sermonSaveMutation.isPending}
                  onSave={(values) => sermonSaveMutation.mutate(values)}
                  onCancel={() => setEditing(null)}
                  onDelete={
                    editing.sermonId !== null
                      ? () => sermonDeleteMutation.mutate(editing.sermonId as number)
                      : undefined
                  }
                />
              </>
            )}
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

      {openSermon &&
        (openSermon.notes.length === 1 ? (
          <SermonNotePopover
            note={openSermon.notes[0]!}
            anchor={openSermon.anchor}
            onClose={() => setOpenSermon(null)}
            onEdit={() => openSermonEdit(openSermon.verse, openSermon.notes[0]!)}
            onDelete={() => {
              setOpenSermon(null);
              sermonDeleteMutation.mutate(openSermon.notes[0]!.id);
            }}
          />
        ) : (
          <SermonNotesPopover
            notes={openSermon.notes}
            anchor={openSermon.anchor}
            onClose={() => setOpenSermon(null)}
            onEdit={(note) => openSermonEdit(openSermon.verse, note)}
            onDelete={(note) => {
              setOpenSermon(null);
              sermonDeleteMutation.mutate(note.id);
            }}
          />
        ))}
    </div>
  );
}
