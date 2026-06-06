import { apiRequest } from "@/lib/api";
import {
  type Annotation,
  type Book,
  type CrossReference,
  type ReadChapter,
  type ResolvedReference,
  type ScopeType,
  type Translation,
  annotationSchema,
  annotationsListSchema,
  booksResponseSchema,
  crossReferencesSchema,
  readChapterSchema,
  resolvedReferenceSchema,
  tagsListSchema,
  translationsResponseSchema,
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
