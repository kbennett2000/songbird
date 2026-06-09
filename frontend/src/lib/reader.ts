import { apiRequest } from "@/lib/api";
import {
  type Annotation,
  type Book,
  type CrossReference,
  type Place,
  type PlaceDetail,
  type PlacesPage,
  type PlaceVerse,
  type RandomVerse,
  type ReadChapter,
  type ResolvedReference,
  type ScopeType,
  type KeywordResult,
  type SemanticResult,
  type JourneyDetail,
  type JourneySummary,
  type JourneysPage,
  type SectionHeading,
  type SermonNote,
  type StrongsDetail,
  type StrongsVerse,
  type StudyNoteResult,
  type TopicDetail,
  type TopicsPage,
  type TopicSummary,
  type TopicVerse,
  type Translation,
  type TranslatorNote,
  type VerseWords,
  annotationSchema,
  annotationsListSchema,
  booksResponseSchema,
  crossReferencesSchema,
  placeDetailSchema,
  placeTypesSchema,
  placeVersesSchema,
  placesPageSchema,
  placesSchema,
  randomVerseSchema,
  readChapterSchema,
  resolvedReferenceSchema,
  keywordResultsSchema,
  sectionHeadingsSchema,
  semanticResultsSchema,
  strongsDetailSchema,
  journeyDetailSchema,
  journeySummariesSchema,
  journeysPageSchema,
  strongsVersesSchema,
  topicDetailSchema,
  topicSummariesSchema,
  topicsPageSchema,
  topicVersesSchema,
  verseWordsSchema,
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

/** The topics a verse appears under (Concord's reverse lookup) — songbird stores none. */
export async function fetchVerseTopics(
  book: string,
  chapter: number,
  verse: number,
): Promise<TopicSummary[]> {
  const data = await apiRequest<unknown>("GET", `/verse-topics/${book}/${chapter}/${verse}`);
  return topicSummariesSchema.parse(data);
}

/** The verses curated under a topic (with text in the read translation) — from Concord. */
export async function fetchTopicVerses(
  topicId: string,
  translation: string,
  limit?: number,
  offset?: number,
): Promise<TopicVerse[]> {
  const params = new URLSearchParams();
  if (translation) params.set("translation", translation);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  const data = await apiRequest<unknown>(
    "GET",
    `/topics/${encodeURIComponent(topicId)}/verses${qs ? `?${qs}` : ""}`,
  );
  return topicVersesSchema.parse(data);
}

export interface TopicFilters {
  q?: string;
  section?: string;
  limit?: number;
  offset?: number;
}

/** One page of the topical-index browse — filter by name (`q`) / section, paginated
 * (`{ topics, total }`). Modeled on browsePlaces. */
export async function fetchTopics(filters: TopicFilters = {}): Promise<TopicsPage> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.section) params.set("section", filters.section);
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  const data = await apiRequest<unknown>("GET", `/topics?${params.toString()}`);
  return topicsPageSchema.parse(data);
}

/** A single topic's full record (name, section, see_also, verse_count). */
export async function fetchTopic(topicId: string): Promise<TopicDetail> {
  const data = await apiRequest<unknown>("GET", `/topics/${encodeURIComponent(topicId)}`);
  return topicDetailSchema.parse(data);
}

/** A verse's tagged original-language tokens (with text_id) — from Concord (songbird owns none).
 * A valid verse with no tagged original returns tokens: [] (the "no data" state, not an error). */
export async function fetchVerseWords(
  book: string,
  chapter: number,
  verse: number,
): Promise<VerseWords> {
  const data = await apiRequest<unknown>("GET", `/verse-words/${book}/${chapter}/${verse}`);
  return verseWordsSchema.parse(data);
}

/** A single Strong's lexicon entry (lemma, definition, source). */
export async function fetchStrongs(strongsId: string): Promise<StrongsDetail> {
  const data = await apiRequest<unknown>("GET", `/strongs/${encodeURIComponent(strongsId)}`);
  return strongsDetailSchema.parse(data);
}

/** The verses where a Strong's number occurs (the concordance, with text in the read translation). */
export async function fetchStrongsVerses(
  strongsId: string,
  translation: string,
  limit?: number,
  offset?: number,
): Promise<StrongsVerse[]> {
  const params = new URLSearchParams();
  if (translation) params.set("translation", translation);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  const data = await apiRequest<unknown>(
    "GET",
    `/strongs/${encodeURIComponent(strongsId)}/verses${qs ? `?${qs}` : ""}`,
  );
  return strongsVersesSchema.parse(data);
}

/** A single journey's full detail (ordered stops, source, the one-reconstruction note) — from
 * Concord (songbird owns no journey data). */
export async function fetchJourney(journeyId: string): Promise<JourneyDetail> {
  const data = await apiRequest<unknown>("GET", `/journeys/${encodeURIComponent(journeyId)}`);
  return journeyDetailSchema.parse(data);
}

/** One page of the curated journeys list (`{ journeys, total }`) — no filters, just pagination. */
export async function fetchJourneys(limit?: number, offset?: number): Promise<JourneysPage> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  const data = await apiRequest<unknown>("GET", `/journeys${qs ? `?${qs}` : ""}`);
  return journeysPageSchema.parse(data);
}

/** The journeys that pass through a place (the reverse lookup) — a bare list. */
export async function fetchPlaceJourneys(placeId: string): Promise<JourneySummary[]> {
  const data = await apiRequest<unknown>("GET", `/places/${encodeURIComponent(placeId)}/journeys`);
  return journeySummariesSchema.parse(data);
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

/** Section headings for a whole chapter in one translation — from Concord (songbird stores no
 * headings). A translation with none returns an empty array (the reader then shows no headings,
 * and no banner — a heading-less chapter is normal). */
export async function fetchHeadings(
  translation: string,
  book: string,
  chapter: number,
): Promise<SectionHeading[]> {
  const data = await apiRequest<unknown>(
    "GET",
    `/headings/${encodeURIComponent(translation)}/${encodeURIComponent(book)}/${chapter}`,
  );
  return sectionHeadingsSchema.parse(data);
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
  const data = await apiRequest<unknown>("GET", `/places/${encodeURIComponent(placeId)}/verses`);
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

/** One random verse for the Welcome "verse of the day" card — fresh every call (no-store). */
export async function fetchRandomVerse(translation?: string): Promise<RandomVerse> {
  const t = translation ? `?translation=${encodeURIComponent(translation)}` : "";
  const data = await apiRequest<unknown>("GET", `/random-verse${t}`);
  return randomVerseSchema.parse(data);
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
  event_date: string | null;
  tags: string[];
}

/** Create a sermon note. The client sends only the human `reference`; the server resolves it
 * through Concord into the canonical anchor + verse span and `book_order_index` (invariant 4
 * stays server-authoritative, and a ranged reference covers every verse in the range). */
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
