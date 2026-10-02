import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api";
import {
  type BibleDocument,
  type DocumentSummary,
  documentSchema,
  documentsResponseSchema,
} from "@/schemas";

/**
 * A book's introduction (v1.8 slice C1): one of a study Bible's documents (Concord ADR-0012),
 * fetched through songbird at request time and never stored (invariants 1 and 5).
 */
export const BOOK_INTRODUCTION = "book-introduction";

/**
 * The Bibles that can offer the open book's introduction, in the order the reader offers them: the
 * one being read, then each ticked under "Notes from other Bibles" (`ticked`, in its order) — each
 * only when Concord says it has documents (`document_count` above 0). An older Concord sends no
 * count, so there are none and the reader offers nothing, as before.
 */
export function introductionSources(
  translations: { id: string; document_count?: number | null }[],
  reading: string,
  ticked: string[],
): string[] {
  const hasDocuments = new Set(
    translations.filter((t) => (t.document_count ?? 0) > 0).map((t) => t.id),
  );
  const sources: string[] = [];
  for (const code of [reading, ...ticked]) {
    if (hasDocuments.has(code) && !sources.includes(code)) sources.push(code);
  }
  return sources;
}

/** A Bible's book introductions, all of them in one short list (a study Bible has 66). */
export async function fetchBookIntroductions(translation: string): Promise<DocumentSummary[]> {
  const data = await apiRequest<unknown>(
    "GET",
    `/translations/${encodeURIComponent(translation)}/documents?kind=${BOOK_INTRODUCTION}`,
  );
  return documentsResponseSchema.parse(data).documents;
}

/**
 * One list per Bible, asked for once a session: Concord's documents never change, so moving
 * through the chapters asks for nothing more.
 */
export function bookIntroductionsOptions(translation: string) {
  return queryOptions({
    queryKey: ["documents", translation, BOOK_INTRODUCTION],
    queryFn: () => fetchBookIntroductions(translation),
    staleTime: Infinity,
  });
}

/** The open book's introduction in a Bible's list, if it has one. */
export function introductionFor(
  list: DocumentSummary[] | undefined,
  book: string,
): DocumentSummary | undefined {
  return list?.find((d) => d.kind === BOOK_INTRODUCTION && d.book === book);
}

export async function fetchDocument(translation: string, slug: string): Promise<BibleDocument> {
  const data = await apiRequest<unknown>(
    "GET",
    `/translations/${encodeURIComponent(translation)}/documents/${encodeURIComponent(slug)}`,
  );
  return documentSchema.parse(data);
}

export function documentOptions(translation: string, slug: string) {
  return queryOptions({
    queryKey: ["document", translation, slug],
    queryFn: () => fetchDocument(translation, slug),
    staleTime: Infinity,
  });
}
