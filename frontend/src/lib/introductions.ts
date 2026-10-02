import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api";
import { type DocumentSummary, documentsResponseSchema } from "@/schemas";

/**
 * A book's introduction (v1.8 slice C1): one of a study Bible's documents (Concord ADR-0012),
 * fetched through songbird at request time and never stored (invariants 1 and 5).
 */
export const BOOK_INTRODUCTION = "book-introduction";

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
