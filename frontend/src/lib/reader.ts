import { apiRequest } from "@/lib/api";
import {
  type Annotation,
  type Book,
  type CrossReference,
  type Place,
  type PlaceVerse,
  type ReadChapter,
  type ResolvedReference,
  type ScopeType,
  type SemanticResult,
  type SermonNote,
  type Translation,
  type TranslatorNote,
  annotationSchema,
  annotationsListSchema,
  booksResponseSchema,
  crossReferencesSchema,
  placeVersesSchema,
  placesSchema,
  readChapterSchema,
  resolvedReferenceSchema,
  semanticResultsSchema,
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

/** Keyword search over the user's notes (Concord-free). Semantic note search awaits a Concord
 * embed endpoint; until then this is the honest stand-in. */
export async function searchAnnotations(q: string): Promise<Annotation[]> {
  const data = await apiRequest<unknown>("GET", `/annotations?q=${encodeURIComponent(q)}`);
  return annotationsListSchema.parse(data);
}
