import { apiRequest } from "@/lib/api";
import {
  type Annotation,
  type Book,
  type ReadChapter,
  type ScopeType,
  type Translation,
  annotationSchema,
  booksResponseSchema,
  readChapterSchema,
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
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  const data = await apiRequest<unknown>("POST", "/annotations", input);
  return annotationSchema.parse(data);
}

export interface UpdateAnnotationInput {
  note_markdown?: string;
  scope_type?: ScopeType;
  translations?: string[];
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
