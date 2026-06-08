import { apiRequest } from "@/lib/api";
import {
  type Annotation,
  type Book,
  type CrossReference,
  type Place,
  type PlaceDetail,
  type PlacesPage,
  type PlaceVerse,
  type ReadChapter,
  type ResolvedReference,
  type ScopeType,
  type KeywordResult,
  type SemanticResult,
  type SermonNote,
  type StudyNoteResult,
  type Translation,
  type TranslatorNote,
  annotationSchema,
  annotationsListSchema,
  booksResponseSchema,
  crossReferencesSchema,
  placeDetailSchema,
  placeTypesSchema,
  placeVersesSchema,
  placesPageSchema,
  placesSchema,
  readChapterSchema,
  resolvedReferenceSchema,
  keywordResultsSchema,
  semanticResultsSchema,
  sermonNoteSchema,
  studyNoteResultsSchema,
  sermonNotesListSchema,
  tagsListSchema,
  translationsResponseSchema,
  translatorNotesSchema,
} from "@/schemas";

export async function fetchBooks(): Promise<Book[]> {
  const data = await apiRequest<unknown>("GET", "/books");
  return booksResponseSchema.parse(data).books;
}

export async function fetchTranslations(): Promise<Translation[]> {
  const data = await apiRequest<unknown>("GET", "/translations");
  return translationsResponseSchema.parse(data).translations;
}

/** Resolve a raw reference ("John 3", "Gen 1:1") to canonical coords — via Concord. */
export async function resolveReference(ref: string): Promise<ResolvedReference> {
  const data = await apiRequest<unknown>("GET", `/resolve?ref=${encodeURIComponent(ref)}`);
  return resolvedReferenceSchema.parse(data);
}

/** Cross-references for a verse — sourced entirely from Concord (songbird stores none). */
export async function fetchCrossReferences(
  book: string,
  chapter: number,
  verse: number,
  translation: string,
): Promise<CrossReference[]> {
  const qs = translation ? `?translation=${encodeURIComponent(translation)}` : "";
  const data = await apiRequest<unknown>(
    "GET",
    `/cross-references/${book}/${chapter}/${verse}${qs}`,
  );
  return crossReferencesSchema.parse(data);
}

/** Translator's notes for a whole chapter in one translation — from Concord (songbird stores
 * no notes). A translation with none returns an empty array (the reader then shows no markers). */
export async function fetchNotes(
  translation: string,
  book: string,
  chapter: number,
): Promise<TranslatorNote[]> {
  const data = await apiRequest<unknown>(
    "GET",
    `/notes/${encodeURIComponent(translation)}/${encodeURIComponent(book)}/${chapter}`,
  );
  return translatorNotesSchema.parse(data);
}

/** Places named in a chapter — from Concord (songbird stores no place data). */
export async function fetchPlaces(book: string, chapter: number): Promise<Place[]> {
  const data = await apiRequest<unknown>(
    "GET",
    `/places?book=${encodeURIComponent(book)}&chapter=${chapter}`,
  );
  return placesSchema.parse(data);
}

/** The verses that mention a place (canonical coords → jump reuses navigation). */
export async function fetchPlaceVerses(placeId: string): Promise<PlaceVerse[]> {
  const data = await apiRequest<unknown>(
    "GET",
    `/places/${encodeURIComponent(placeId)}/verses`,
  );
  return placeVersesSchema.parse(data);
}

// --- Gazetteer (v1.4): browse the WHOLE place corpus + per-place detail. Distinctly named from
// the per-chapter map's fetchPlaces/fetchPlaceVerses above (which are untouched).

export interface PlaceFilters {
  type?: string;
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** One page of the gazetteer — filter by type/status/name, paginated (`{ places, total }`). */
export async function browsePlaces(filters: PlaceFilters = {}): Promise<PlacesPage> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  const data = await apiRequest<unknown>("GET", `/places/browse?${params.toString()}`);
  return placesPageSchema.parse(data);
}

/** A single place's full record (honesty model + detail fields). */
export async function fetchPlace(placeId: string): Promise<PlaceDetail> {
  const data = await apiRequest<unknown>("GET", `/places/${encodeURIComponent(placeId)}`);
  return placeDetailSchema.parse(data);
}

/** The gazetteer's `type` vocabulary, from Concord (empty → the UI hides the type filter). */
export async function fetchPlaceTypes(): Promise<string[]> {
  const data = await apiRequest<unknown>("GET", "/place-types");
  return placeTypesSchema.parse(data);
}

export async function fetchChapter(
  translation: string,
  book: string,
  chapter: number,
): Promise<ReadChapter> {
  const data = await apiRequest<unknown>("GET", `/read/${translation}/${book}/${chapter}`);
  return readChapterSchema.parse(data);
}

export interface CreateAnnotationInput {
  book_usfm: string;
  start_chapter: number;
  start_verse: number;
  end_chapter: number;
  end_verse: number;
  note_markdown: string;
  scope_type: ScopeType;
  translations: string[];
  tags: string[];
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  const data = await apiRequest<unknown>("POST", "/annotations", input);
  return annotationSchema.parse(data);
}

export interface UpdateAnnotationInput {
  note_markdown?: string;
  scope_type?: ScopeType;
  translations?: string[];
  tags?: string[];
}

export async function updateAnnotation(
  id: number,
  input: UpdateAnnotationInput,
): Promise<Annotation> {
  const data = await apiRequest<unknown>("PATCH", `/annotations/${id}`, input);
  return annotationSchema.parse(data);
}

export async function deleteAnnotation(id: number): Promise<void> {
  await apiRequest<void>("DELETE", `/annotations/${id}`);
}

export interface CreateSermonNoteInput {
  title: string;
  sermon_url: string;
  reference: string;
  book_usfm: string;
  start_chapter: number;
  start_verse: number;
  end_chapter: number;
  end_verse: number;
  event_date: string | null;
  tags: string[];
}

/** Create a sermon note. The server resolves `book_order_index` from Concord — the client only
 * sends the canonical anchor (invariant 4 stays server-authoritative). */
export async function createSermonNote(input: CreateSermonNoteInput): Promise<SermonNote> {
  const data = await apiRequest<unknown>("POST", "/sermon-notes", input);
  return sermonNoteSchema.parse(data);
}

export interface UpdateSermonNoteInput {
  title?: string;
  sermon_url?: string;
  reference?: string;
  event_date?: string | null;
  tags?: string[];
}

export async function updateSermonNote(
  id: number,
  input: UpdateSermonNoteInput,
): Promise<SermonNote> {
  const data = await apiRequest<unknown>("PATCH", `/sermon-notes/${id}`, input);
  return sermonNoteSchema.parse(data);
}

export async function deleteSermonNote(id: number): Promise<void> {
  await apiRequest<void>("DELETE", `/sermon-notes/${id}`);
}

/** All tags in songbird (for the editor's type-ahead). Concord-free. */
export async function fetchTags(): Promise<string[]> {
  const data = await apiRequest<unknown>("GET", "/tags");
  return tagsListSchema.parse(data);
}

/** Browse annotations, optionally narrowed by tags (AND). Concord-free. */
export async function browseAnnotations(
  tags: string[],
  match: "all" | "any" = "all",
): Promise<Annotation[]> {
  const qs = tags.length > 0 ? `?tags=${encodeURIComponent(tags.join(","))}&match=${match}` : "";
  const data = await apiRequest<unknown>("GET", `/annotations${qs}`);
  return annotationsListSchema.parse(data);
}

/** Browse sermon notes, optionally narrowed by tags (AND). Shares the tag vocabulary with
 * annotations so the same filter narrows both. Concord-free. */
export async function browseSermonNotes(
  tags: string[],
  match: "all" | "any" = "all",
): Promise<SermonNote[]> {
  const qs = tags.length > 0 ? `?tags=${encodeURIComponent(tags.join(","))}&match=${match}` : "";
  const data = await apiRequest<unknown>("GET", `/sermon-notes${qs}`);
  return sermonNotesListSchema.parse(data);
}

/** Search Scripture by meaning — via Concord's semantic search (songbird runs no ML). */
export async function semanticSearch(
  q: string,
  translation: string,
  limit = 20,
): Promise<SemanticResult[]> {
  const t = translation ? `&translation=${encodeURIComponent(translation)}` : "";
  const data = await apiRequest<unknown>(
    "GET",
    `/semantic-search?q=${encodeURIComponent(q)}&limit=${limit}${t}`,
  );
  return semanticResultsSchema.parse(data);
}

/**
 * Search Scripture for an exact word/phrase — via Concord's keyword search (issue #46).
 * Searches all loaded translations by default; pass a non-empty `translations` list to narrow to
 * that subset. Each hit then carries a `matches` map (translation id → highlighted snippet).
 */
export async function keywordSearch(
  q: string,
  translations?: string[],
  limit = 20,
): Promise<KeywordResult[]> {
  // Narrow only when a non-empty subset is chosen; omit the param for "all" (backend default).
  const t =
    translations && translations.length > 0
      ? `&translations=${encodeURIComponent(translations.join(","))}`
      : "";
  const data = await apiRequest<unknown>(
    "GET",
    `/keyword-search?q=${encodeURIComponent(q)}&limit=${limit}${t}`,
  );
  return keywordResultsSchema.parse(data);
}

/** Keyword search over the user's notes (Concord-free). Semantic note search awaits a Concord
 * embed endpoint; until then this is the honest stand-in. */
export async function searchAnnotations(q: string): Promise<Annotation[]> {
  const data = await apiRequest<unknown>("GET", `/annotations?q=${encodeURIComponent(q)}`);
  return annotationsListSchema.parse(data);
}

/**
 * Keyword search over Concord's translator's/study notes — the "Study notes" section, distinct
 * from the user's own "Your notes". Best-effort: the backend swallows any failure to [], so this
 * resolves to an empty list (and the section won't render) rather than throwing.
 */
export async function searchStudyNotes(q: string): Promise<StudyNoteResult[]> {
  const data = await apiRequest<unknown>("GET", `/study-notes-search?q=${encodeURIComponent(q)}`);
  return studyNoteResultsSchema.parse(data);
}
