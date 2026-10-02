import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api";
import {
  type BibleDocument,
  type DocumentSummary,
  documentSchema,
  documentsResponseSchema,
} from "@/schemas";

/**
 * A study Bible's documents (Concord ADR-0012): its book introductions, front matter, reading plan
 * and notes about the edition, fetched through songbird at request time and never stored
 * (invariants 1 and 5).
 */

/**
 * The Bibles that can offer documents, in the order the reader offers them: the one being read,
 * then each ticked under "Notes from other Bibles" (`ticked`, in its order) — each only when
 * Concord says it has documents (`document_count` above 0). An older Concord sends no count, so
 * there are none and nothing is offered, as before.
 */
export function documentSources(
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

/** Every document a Bible has, in Concord's order (by kind, then each one's place in print). */
export async function fetchDocumentList(translation: string): Promise<DocumentSummary[]> {
  const data = await apiRequest<unknown>(
    "GET",
    `/translations/${encodeURIComponent(translation)}/documents`,
  );
  return documentsResponseSchema.parse(data).documents;
}

/**
 * One list per Bible, asked for once a session: Concord's documents never change. The reader and
 * Settings share it.
 */
export function documentListOptions(translation: string) {
  return queryOptions({
    queryKey: ["documents", translation, "all"],
    queryFn: () => fetchDocumentList(translation),
    staleTime: Infinity,
  });
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

/** The kinds a Bible's About page shows, in the order a study Bible prints them. */
export const ABOUT_KINDS = ["front-matter", "reading-plan", "about"] as const;
export type AboutKind = (typeof ABOUT_KINDS)[number];

const KIND_LABELS: Record<AboutKind, string> = {
  "front-matter": "Front matter",
  "reading-plan": "Reading plan",
  about: "About the edition",
};

/** A kind's name on the About page ("Front matter"), or null for a kind it doesn't show. */
export function aboutKindLabel(kind: string): string | null {
  return (ABOUT_KINDS as readonly string[]).includes(kind) ? KIND_LABELS[kind as AboutKind] : null;
}

export interface AboutGroup {
  kind: AboutKind;
  label: string;
  documents: DocumentSummary[];
}

/**
 * A Bible's About page: its front matter, reading plan and notes about the edition, grouped by
 * kind in that order, each group in Concord's order. Book introductions belong to the reader's
 * chapters, and a kind Concord adds later isn't shown until songbird knows how to name it.
 */
export function aboutGroups(list: DocumentSummary[] | undefined): AboutGroup[] {
  return ABOUT_KINDS.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    documents: (list ?? []).filter((d) => d.kind === kind),
  })).filter((g) => g.documents.length > 0);
}
