import { apiRequest } from "@/lib/api";
import {
  type Annotation,
  type Book,
  type ReadChapter,
  annotationSchema,
  booksResponseSchema,
  readChapterSchema,
} from "@/schemas";

export async function fetchBooks(): Promise<Book[]> {
  const data = await apiRequest<unknown>("GET", "/books");
  return booksResponseSchema.parse(data).books;
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
}

export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  const data = await apiRequest<unknown>("POST", "/annotations", input);
  return annotationSchema.parse(data);
}

export async function updateAnnotation(id: number, note_markdown: string): Promise<Annotation> {
  const data = await apiRequest<unknown>("PATCH", `/annotations/${id}`, { note_markdown });
  return annotationSchema.parse(data);
}

export async function deleteAnnotation(id: number): Promise<void> {
  await apiRequest<void>("DELETE", `/annotations/${id}`);
}
