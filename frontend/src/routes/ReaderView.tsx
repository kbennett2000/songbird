import {
  type UseQueryResult,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type FormEvent,
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CrossReferences } from "@/components/CrossReferences";
import { AnnotationsPopover } from "@/components/AnnotationsPopover";
import { Geography } from "@/components/Geography";
import { Modal } from "@/components/Modal";
import { NoteEditor } from "@/components/NoteEditor";
import { NoteLookSwatch } from "@/components/NoteLookSwatch";
import { NotePopover } from "@/components/NotePopover";
import { Popover } from "@/components/Popover";
import { ScopePicker } from "@/components/ScopePicker";
import { SermonNoteForm, type SermonNoteFormValues } from "@/components/SermonNoteForm";
import { SermonNotePopover } from "@/components/SermonNotePopover";
import { SermonNotesPopover } from "@/components/SermonNotesPopover";
import { SidePanel } from "@/components/SidePanel";
import { TagInput } from "@/components/TagInput";
import { TopNav } from "@/components/TopNav";
import { VerseText } from "@/components/VerseText";
import { VerseTopics } from "@/components/VerseTopics";
import { WordStudy } from "@/components/WordStudy";
import { ME_KEY, useAuth } from "@/hooks/useAuth";
import { useShowNotesFrom } from "@/hooks/useShowNotesFrom";

// Lazy-loaded: the map pulls in MapLibre (~300 KB gz), only needed when the map modal opens.
const MapView = lazy(() => import("@/components/MapView").then((m) => ({ default: m.MapView })));
import {
  NOTE_COUNT_BADGE,
  NOTE_MARKER,
  OUT_OF_SCOPE_COUNT_BADGE,
  OUT_OF_SCOPE_MARKER,
  SERMON_COUNT_BADGE,
  SERMON_MARKER,
  VERSE_HIGHLIGHT,
} from "@/lib/annotationStyles";
import { ApiError } from "@/lib/api";
import { saveReadingPosition } from "@/lib/auth";
import { borrowNotes, noteSources, type ShownNote } from "@/lib/borrowedNotes";
import { noteLook, noteSourceOf } from "@/lib/noteLooks";
import { nextChapter, prevChapter } from "@/lib/navigation";
import {
  createAnnotation,
  createSermonNote,
  deleteAnnotation,
  deleteSermonNote,
  fetchBooks,
  fetchChapter,
  fetchHeadings,
  fetchNotes,
  fetchPlaces,
  fetchTags,
  resolveReference,
  translationsOptions,
  updateAnnotation,
  updateSermonNote,
} from "@/lib/reader";
import type {
  ReadAnnotation,
  ReadChapter,
  ReadVerse,
  Scope,
  SectionHeading,
  SermonNote,
  TranslatorNote,
} from "@/schemas";

const DEFAULT_TRANSLATION = "KJV";

// Only a genuine Concord outage warrants the notes notice. A 404 (NOT_FOUND) means "no notes for
// this passage" — markers simply absent, no scary message — while CONCORD_UNREACHABLE (502) and
// NETWORK_ERROR (0) still surface. Before the Concord v1.1.0 pin the notes route 404'd on every
// translation, so this fired on every chapter; the bump makes a 404 mean genuinely-not-found.
function isOutage(q: { isError: boolean; error: unknown }): boolean {
  return q.isError && !(q.error instanceof ApiError && q.error.code === "NOT_FOUND");
}

// Combiners for the per-source borrowing queries. Module-level so their identity is stable, which
// lets TanStack Query hand back the same combined result while nothing has changed.
function combineBorrowedNotes(results: UseQueryResult<TranslatorNote[]>[]) {
  return { data: results.map((r) => r.data), outage: results.some(isOutage) };
}
function combineBorrowedChapters(results: UseQueryResult<ReadChapter>[]) {
  return { data: results.map((r) => r.data), outage: results.some(isOutage) };
}

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

interface TopicsView {
  book: string;
  chapter: number;
  verse: number;
  reference: string;
}

interface WordsView {
  book: string;
  chapter: number;
  verse: number;
  reference: string;
}

export function ReaderView(): JSX.Element {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // A jump-from-browse arrives as ?book=&chapter=&verse=; seed the initial location from it.
  const [searchParams] = useSearchParams();
  // Reopen to where this profile last read (RequireAuth guarantees `user` is loaded by the time
  // the reader mounts). Priority: an explicit deep link (?book=&chapter= from Browse) wins, then
  // the saved position, then the first-time defaults.
  const [translation, setTranslation] = useState(
    () => user?.last_translation ?? DEFAULT_TRANSLATION,
  );
  const [book, setBook] = useState(() => searchParams.get("book") ?? user?.last_book ?? "JHN");
  const [chapter, setChapter] = useState(() =>
    Number(searchParams.get("chapter") ?? user?.last_chapter ?? 3),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [xref, setXref] = useState<XrefView | null>(null);
  const [topics, setTopics] = useState<TopicsView | null>(null);
  const [words, setWords] = useState<WordsView | null>(null);
  const [geo, setGeo] = useState(false);
  const [map, setMap] = useState(false);
  // The translator's note whose popover is open, with the marker it's anchored to.
  const [openNote, setOpenNote] = useState<{ note: ShownNote; anchor: HTMLElement } | null>(null);
  // The chapter's Notes menu (other Bibles' notes), anchored to its button while open.
  const [notesMenu, setNotesMenu] = useState<HTMLElement | null>(null);
  // The sermon notes covering the tapped verse, whose popover is open (separate system —
  // canonical, all-translations). One note → single popover; several → a stacked list.
  const [openSermon, setOpenSermon] = useState<{
    notes: SermonNote[];
    anchor: HTMLElement;
    verse: ReadVerse;
  } | null>(null);
  // The annotations behind a tapped marker, when there are several (single → editor directly).
  // The list shares one in/out-of-scope class; a row's "Open" hands it to openExisting (#114).
  const [openAnnotations, setOpenAnnotations] = useState<{
    annotations: ReadAnnotation[];
    anchor: HTMLElement;
    verse: ReadVerse;
  } | null>(null);
  const [refInput, setRefInput] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [sermonSaveError, setSermonSaveError] = useState<string | null>(null);
  const [highlightVerse, setHighlightVerse] = useState<number | null>(() => {
    const v = searchParams.get("verse");
    return v ? Number(v) : null;
  });

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const translationsQuery = useQuery(translationsOptions);
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
  // Any places at all (located or not) — the panel is pointless when a chapter names none (#55).
  const hasPlaces = (placesQuery.data ?? []).length > 0;
  // Translator's notes for the chapter, in the CURRENT translation (NET's tn/sn/tc/map). The key
  // includes `translation`, so switching away from NET refetches → empty → markers clear, while
  // the canonical annotations (from chapterQuery) are untouched. Notes overlay verse text only;
  // an unreachable Concord surfaces a small notice without blocking the already-loaded chapter.
  const notesQuery = useQuery({
    queryKey: ["notes", translation, chapterBook, chapter],
    queryFn: () => fetchNotes(translation, chapterBook, chapter),
  });
  // Notes from other Bibles (opt-in, ADR 0005): one "Show … notes" tick per notes source other
  // than the translation being read, in the chapter's Notes menu (every source is on Settings) (`noteSources`: Concord's note_count, or NET alone
  // against an older Concord), ticked per the user's `show_notes_from`. For each ticked source,
  // fetch its notes and its verse text (placing a note needs the source's words; ADR 0004) —
  // sharing cache keys with reading that translation itself, and only while borrowing.
  const notesSources = useMemo(() => noteSources(translationsQuery.data ?? []), [translationsQuery.data]);
  const offeredSources = useMemo(
    () => notesSources.filter((code) => code !== translation),
    [notesSources, translation],
  );
  const { showNotesFrom, setShowNotesFrom } = useShowNotesFrom();
  const borrowFrom = offeredSources.filter((code) => showNotesFrom.includes(code));
  const borrowedNotes = useQueries({
    queries: borrowFrom.map((code) => ({
      queryKey: ["notes", code, chapterBook, chapter],
      queryFn: () => fetchNotes(code, chapterBook, chapter),
    })),
    combine: combineBorrowedNotes,
  });
  const borrowedChapters = useQueries({
    queries: borrowFrom.map((code) => ({
      queryKey: ["chapter", code, book, chapter],
      queryFn: () => fetchChapter(code, book, chapter),
    })),
    combine: combineBorrowedChapters,
  });
  // Borrowed notes follow the same rule as the translation's own: an outage is an error (the
  // notice), never a silent fallback (invariant 3).
  const notesUnreachable =
    isOutage(notesQuery) || borrowedNotes.outage || borrowedChapters.outage;
  const borrowKey = borrowFrom.join(",");
  const notesByVerse = useMemo(() => {
    const map = new Map<number, ShownNote[]>();
    for (const note of notesQuery.data ?? []) {
      const list = map.get(note.verse);
      if (list) list.push(note);
      else map.set(note.verse, [note]);
    }
    // Each source's notes, placed on this translation's words. `rank` is the source's checkbox
    // position, so notes at one spot read: the translation's own, then sources in that order.
    const codes = borrowKey ? borrowKey.split(",") : [];
    codes.forEach((code, i) => {
      const notes = borrowedNotes.data[i];
      const sourceChapter = borrowedChapters.data[i];
      if (!notes || !sourceChapter || !chapterQuery.data) return;
      const rank = offeredSources.indexOf(code);
      const placed = borrowNotes(notes, sourceChapter.verses, chapterQuery.data.verses, code, rank);
      for (const [verse, list] of placed) map.set(verse, [...(map.get(verse) ?? []), ...list]);
    });
    return map;
  }, [
    notesQuery.data,
    borrowKey,
    offeredSources,
    borrowedNotes.data,
    borrowedChapters.data,
    chapterQuery.data,
  ]);

  // Each notes Bible's look (lib/noteLooks.ts): a marker, its note view and the Notes menu's key
  // all wear the look of the Bible the note came from, whether it's read here or borrowed.
  const lookOf = useCallback(
    (note: ShownNote) => noteLook(noteSourceOf(note, translation), notesSources),
    [translation, notesSources],
  );

  // Tick or untick one source from the Notes menu (saved to the profile by the hook).
  const toggleSource = (code: string, on: boolean) => {
    if (!on) setOpenNote(null); // its marker may be about to disappear
    setShowNotesFrom(code, on);
  };

  // Section headings for the chapter, in the CURRENT translation. Keyed like notes so switching
  // translation refetches. Pure enrichment: on error OR empty we render nothing and show NO
  // banner — a heading-less chapter is the normal state for most translations, so a notice
  // would be noise (the deliberate divergence from notes, which DOES banner a genuine outage).
  const headingsQuery = useQuery({
    queryKey: ["headings", translation, chapterBook, chapter],
    queryFn: () => fetchHeadings(translation, chapterBook, chapter),
  });
  const headingsByBeforeVerse = useMemo(() => {
    const map = new Map<number, SectionHeading[]>();
    for (const heading of headingsQuery.data ?? []) {
      const list = map.get(heading.before_verse);
      if (list) list.push(heading);
      else map.set(heading.before_verse, [heading]);
    }
    // Multiple headings before one verse render in ordinal order.
    for (const list of map.values()) list.sort((a, b) => a.ordinal - b.ordinal);
    return map;
  }, [headingsQuery.data]);

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
        .then((updated) => queryClient.setQueryData(ME_KEY, updated))
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
    setTopics(null);
    setWords(null);
    setGeo(false);
    setMap(false);
    setOpenNote(null);
    setOpenSermon(null);
    setOpenAnnotations(null);
  };

  // Bottom-of-chapter nav: go to the chapter, then start reading it from the top.
  const navigateToTop = (b: string, c: number) => {
    navigate(b, c);
    if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
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
          event_date: values.event_date,
          tags: editing.tags,
        });
      }
    },
    onSuccess: async () => {
      setSermonSaveError(null);
      await invalidateChapter();
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
      setEditing(null);
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : "";
      setSermonSaveError(
        code === "NOT_FOUND"
          ? "Couldn't find that reference — check the spelling (e.g. Joshua 6:1-16)."
          : "Couldn't save that sermon note (is Concord reachable?).",
      );
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
    setTopics(null);
    setWords(null);
    setGeo(false);
    setMap(false);
    setSermonSaveError(null);
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
    setTopics(null);
    setWords(null);
    setGeo(false);
    setMap(false);
    setOpenAnnotations(null);
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
    setTopics(null);
    setWords(null);
    setGeo(false);
    setMap(false);
    setSermonSaveError(null);
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
    setTopics(null);
    setWords(null);
    setXref({
      book: chapterQuery.data?.book ?? book,
      chapter,
      verse: verse.verse,
      reference: verse.reference,
    });
  };

  const openTopics = (verse: ReadVerse) => {
    setEditing(null);
    setXref(null);
    setGeo(false);
    setMap(false);
    setWords(null);
    setTopics({
      book: chapterQuery.data?.book ?? book,
      chapter,
      verse: verse.verse,
      reference: verse.reference,
    });
  };

  const openWords = (verse: ReadVerse) => {
    setEditing(null);
    setXref(null);
    setGeo(false);
    setMap(false);
    setTopics(null);
    setWords({
      book: chapterQuery.data?.book ?? book,
      chapter,
      verse: verse.verse,
      reference: verse.reference,
    });
  };

  const openGeo = () => {
    setEditing(null);
    setXref(null);
    setTopics(null);
    setWords(null);
    setMap(false);
    setGeo(true);
  };

  const openMap = () => {
    setEditing(null);
    setXref(null);
    setTopics(null);
    setWords(null);
    setGeo(false);
    setMap(true);
  };

  const closePanel = () => {
    setEditing(null);
    setXref(null);
    setTopics(null);
    setWords(null);
    setGeo(false);
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav
        compareHref={`/compare?translation=${encodeURIComponent(translation)}&book=${encodeURIComponent(book)}&chapter=${chapter}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-400">Book</span>
            <select
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1"
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
            <span className="text-gray-500 dark:text-gray-400">Chapter</span>
            <select
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1"
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
            <span className="text-gray-500 dark:text-gray-400">Translation</span>
            <select
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1"
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

        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={submitRef} className="flex w-full items-center gap-2 sm:w-auto">
            <input
              type="text"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              placeholder="Jump to… e.g. John 3, Gen 1:1"
              aria-label="Jump to reference"
              className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm sm:w-56 sm:flex-none"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={resolveMutation.isPending}
            >
              Go
            </button>
            {resolveError && (
              <span className="text-sm text-red-600 dark:text-red-400">{resolveError}</span>
            )}
          </form>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              onClick={() => prev && navigate(prev.book, prev.chapter)}
              disabled={!prev}
              aria-label="Previous chapter"
            >
              ← Prev
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              onClick={() => next && navigate(next.book, next.chapter)}
              disabled={!next}
              aria-label="Next chapter"
            >
              Next →
            </button>
          </div>
        </div>
      </TopNav>

      <main className="mx-auto max-w-3xl p-6">
        {chapterQuery.isPending && (
          <p className="text-gray-500 dark:text-gray-400">Loading chapter…</p>
        )}
        {chapterQuery.isError && (
          <p className="text-red-600 dark:text-red-400">
            Couldn&rsquo;t load this chapter. Is Concord reachable?
          </p>
        )}
        {chapterQuery.data && (
          <article className="font-serif text-lg leading-8">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="font-sans text-xl font-semibold">{chapterQuery.data.reference}</h2>
              <button
                type="button"
                className="rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 font-sans text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent"
                onClick={openGeo}
                disabled={!hasPlaces}
                title={hasPlaces ? "Places in this chapter" : "No places in this passage"}
              >
                Places in this chapter
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 font-sans text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent"
                onClick={openMap}
                disabled={!hasMappable}
                aria-label="Show map"
                title={hasMappable ? "Show map" : "No mapped locations in this passage"}
              >
                🌐 Map
              </button>
              {/* Other Bibles' notes, two taps away while reading; the full list is on Settings.
                  Shown when there's a source to offer, or when the list of Bibles failed to load —
                  an empty menu would hide that (invariant 3). */}
              {(offeredSources.length > 0 || translationsQuery.isError) && (
                <button
                  type="button"
                  className="rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 font-sans text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={(e) => setNotesMenu(notesMenu ? null : e.currentTarget)}
                  aria-expanded={notesMenu !== null}
                  aria-label="Notes from other Bibles"
                  title="Show notes from other Bibles"
                >
                  Notes ▾
                </button>
              )}
            </div>
            {notesUnreachable && (
              <p className="mb-3 font-sans text-sm text-red-600 dark:text-red-400">
                Translator&rsquo;s notes unavailable (is Concord reachable?).
              </p>
            )}
            {chapterQuery.data.verses.map((v) => {
              const inScope = v.annotations.filter((a) => a.in_scope);
              const outScope = v.annotations.filter((a) => !a.in_scope);
              const headings = headingsByBeforeVerse.get(v.verse) ?? [];
              return (
                <Fragment key={v.verse}>
                  {/* Section headings sit above the whole verse row (number button + text) —
                      a real <h3> for screen-reader structure, nested under the chapter <h2>.
                      A third, quieter layer, distinct from blue verse numbers and violet
                      note markers. */}
                  {headings.map((h) => (
                    <h3
                      key={h.ordinal}
                      className="mt-6 mb-2 font-sans text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                    >
                      {h.text}
                    </h3>
                  ))}
                  <p
                    id={`v-${v.verse}`}
                    className={`group relative -mx-3 rounded px-3 py-0.5 ${
                      inScope.length > 0 ? VERSE_HIGHLIGHT : ""
                    } ${highlightVerse === v.verse ? "ring-2 ring-blue-400" : ""}`}
                  >
                    <button
                      type="button"
                      className="mr-1 align-super text-xs font-sans font-semibold text-blue-700 dark:text-blue-400 hover:underline"
                      onClick={() => openNew(v)}
                      aria-label={`Annotate verse ${v.verse}`}
                    >
                      {v.verse}
                    </button>
                    <VerseText
                      text={v.text ?? ""}
                      notes={notesByVerse.get(v.verse) ?? []}
                      onOpenNote={(note, anchor) => setOpenNote({ note, anchor })}
                      lookOf={lookOf}
                    />
                    {inScope.length > 0 && (
                      <button
                        type="button"
                        className={`ml-2 align-middle ${NOTE_MARKER}`}
                        onClick={(e) =>
                          inScope.length === 1
                            ? openExisting(v, inScope[0]!)
                            : setOpenAnnotations({
                                annotations: inScope,
                                anchor: e.currentTarget,
                                verse: v,
                              })
                        }
                        aria-label={
                          inScope.length === 1
                            ? `View note on verse ${v.verse}`
                            : `${inScope.length} notes on verse ${v.verse}`
                        }
                        title={inScope.length === 1 ? "View note" : "View notes"}
                      >
                        ●
                        {inScope.length > 1 && (
                          <span
                            className={`ml-0.5 rounded-full px-1 text-[0.7em] font-semibold ${NOTE_COUNT_BADGE}`}
                          >
                            {inScope.length}
                          </span>
                        )}
                      </button>
                    )}
                    {outScope.length > 0 && (
                      <button
                        type="button"
                        className={`ml-2 align-middle ${OUT_OF_SCOPE_MARKER}`}
                        onClick={(e) =>
                          outScope.length === 1
                            ? openExisting(v, outScope[0]!)
                            : setOpenAnnotations({
                                annotations: outScope,
                                anchor: e.currentTarget,
                                verse: v,
                              })
                        }
                        aria-label={
                          outScope.length === 1
                            ? `View out-of-scope note on verse ${v.verse}`
                            : `${outScope.length} out-of-scope notes on verse ${v.verse}`
                        }
                        title={`Written for ${[...new Set(outScope.flatMap((a) => a.scope_translations))].join(", ")}`}
                      >
                        ○
                        {outScope.length > 1 && (
                          <span
                            className={`ml-0.5 rounded-full px-1 text-[0.7em] font-semibold ${OUT_OF_SCOPE_COUNT_BADGE}`}
                          >
                            {outScope.length}
                          </span>
                        )}
                      </button>
                    )}
                    {v.sermon_notes.length > 0 && (
                      <button
                        type="button"
                        className={`ml-2 align-middle ${SERMON_MARKER}`}
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
                          <span
                            className={`ml-0.5 rounded-full px-1 text-[0.7em] font-semibold ${SERMON_COUNT_BADGE}`}
                          >
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
                    <button
                      type="button"
                      className="ml-2 align-middle text-xs text-gray-300 opacity-0 transition hover:text-blue-600 group-hover:opacity-100"
                      onClick={() => openTopics(v)}
                      aria-label={`Topics for verse ${v.verse}`}
                      title="Topics"
                    >
                      ※
                    </button>
                    <button
                      type="button"
                      className="ml-2 align-middle text-xs text-gray-300 opacity-0 transition hover:text-blue-600 group-hover:opacity-100"
                      onClick={() => openWords(v)}
                      aria-label={`Original language for verse ${v.verse}`}
                      title="Original language"
                    >
                      ℵ
                    </button>
                  </p>
                </Fragment>
              );
            })}
          </article>
        )}
        {chapterQuery.data && (
          <nav aria-label="Chapter navigation" className="mt-8 flex justify-between font-sans">
            <button
              type="button"
              className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              onClick={() => prev && navigateToTop(prev.book, prev.chapter)}
              disabled={!prev}
              aria-label="Previous chapter (bottom)"
            >
              ← Prev
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              onClick={() => next && navigateToTop(next.book, next.chapter)}
              disabled={!next}
              aria-label="Next chapter (bottom)"
            >
              Next →
            </button>
          </nav>
        )}
      </main>

      <SidePanel
        open={editing !== null || xref !== null || topics !== null || words !== null || geo}
        title={
          editing
            ? editing.kind === "sermon"
              ? `${editing.sermonId !== null ? "Edit sermon" : "Sermon"} on ${editing.verse.reference}`
              : `Note on ${editing.verse.reference}`
            : xref
              ? `Cross-references — ${xref.reference}`
              : topics
                ? `Topics — ${topics.reference}`
                : words
                  ? `Original language — ${words.reference}`
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
              <div
                className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-700 p-1"
                role="tablist"
              >
                {(["annotation", "sermon"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={editing.kind === k}
                    className={`flex-1 rounded-md px-3 py-1 text-sm font-medium ${
                      editing.kind === k
                        ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
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
                  error={sermonSaveError}
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
        {topics && (
          <VerseTopics
            book={topics.book}
            chapter={topics.chapter}
            verse={topics.verse}
            translation={translation}
            onJump={(b, c, v) => navigate(b, c, v)}
          />
        )}
        {words && (
          <WordStudy
            book={words.book}
            chapter={words.chapter}
            verse={words.verse}
            translation={translation}
            onJump={(b, c, v) => navigate(b, c, v)}
          />
        )}
        {geo && (
          <Geography book={chapterBook} chapter={chapter} onJump={(b, c, v) => navigate(b, c, v)} />
        )}
      </SidePanel>

      <Modal
        open={map}
        title={`Map — ${chapterQuery.data?.reference ?? ""}`}
        onClose={() => setMap(false)}
      >
        {map && (
          <Suspense
            fallback={<p className="text-sm text-gray-500 dark:text-gray-400">Loading map…</p>}
          >
            <MapView book={chapterBook} chapter={chapter} onJump={(b, c, v) => navigate(b, c, v)} />
          </Suspense>
        )}
      </Modal>

      {notesMenu && (
        <Popover
          anchor={notesMenu}
          onClose={() => setNotesMenu(null)}
          ariaLabel="Notes from other Bibles"
        >
          {translationsQuery.isError ? (
            <p className="text-red-600 dark:text-red-400">
              Couldn&rsquo;t load the Bibles from Concord. Is it reachable?
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {offeredSources.map((code) => (
                <label key={code} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={showNotesFrom.includes(code)}
                    onChange={(e) => toggleSource(code, e.target.checked)}
                    aria-label={`Show ${code} notes`}
                  />
                  <NoteLookSwatch look={noteLook(code, notesSources)} />
                  <span>Show {code} notes</span>
                </label>
              ))}
            </div>
          )}
          <Link
            to="/settings"
            className="mt-2 block border-t border-gray-100 dark:border-gray-700 pt-2 text-blue-700 dark:text-blue-400 hover:underline"
          >
            All settings ›
          </Link>
        </Popover>
      )}

      {openNote && (
        <NotePopover
          note={openNote.note}
          source={noteSourceOf(openNote.note, translation)}
          look={lookOf(openNote.note)}
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

      {openAnnotations && (
        <AnnotationsPopover
          annotations={openAnnotations.annotations}
          anchor={openAnnotations.anchor}
          onClose={() => setOpenAnnotations(null)}
          onOpen={(annotation) => openExisting(openAnnotations.verse, annotation)}
        />
      )}
    </div>
  );
}
