import { z } from "zod";

export const translationSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string(),
  versification: z.string(),
  attribution: z.string().nullable(),
});

export const translationsResponseSchema = z.object({
  translations: z.array(translationSchema),
});

export const concordStatusSchema = z.object({
  base_url: z.string(),
  reachable: z.boolean(),
  status: z.string().nullable(),
  translation_count: z.number().nullable(),
  error: z.string().nullable(),
});

export const healthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  concord: concordStatusSchema,
});

export type Translation = z.infer<typeof translationSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// --- Reader + annotations (Slice 1) ---

export const bookSchema = z.object({
  id: z.string(), // USFM code
  name: z.string(),
  testament: z.string(),
  chapter_count: z.number().nullable(),
  canonical_order: z.number(),
});

export const booksResponseSchema = z.object({
  books: z.array(bookSchema),
});

export const annotationSchema = z.object({
  id: z.number(),
  book_usfm: z.string(),
  start_chapter: z.number(),
  start_verse: z.number(),
  end_chapter: z.number(),
  end_verse: z.number(),
  note_markdown: z.string(),
  color: z.string().nullable(),
  scope_type: z.string(),
  scope_translations: z.array(z.string()),
  tags: z.array(z.string()),
  author_id: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const annotationsListSchema = z.array(annotationSchema);
export const tagsListSchema = z.array(z.string());

// An overlaid annotation also carries whether it's in scope for the translation being read.
export const readAnnotationSchema = annotationSchema.extend({
  in_scope: z.boolean(),
});

export const readVerseSchema = z.object({
  book: z.string(),
  chapter: z.number(),
  verse: z.number(),
  reference: z.string(),
  text: z.string().nullable(),
  annotations: z.array(readAnnotationSchema),
});

export const readChapterSchema = z.object({
  translation: z.string(),
  book: z.string(),
  chapter: z.number(),
  reference: z.string(),
  verses: z.array(readVerseSchema),
});

export const resolvedReferenceSchema = z.object({
  reference: z.string(),
  book: z.string(),
  chapter: z.number(),
  verse: z.number().nullable(),
});

// A cross-reference target (from Concord). Coords are canonical → jump reuses navigation.
export const crossReferenceSchema = z.object({
  book: z.string(),
  chapter: z.number(),
  verse_start: z.number(),
  verse_end: z.number().nullable(),
  reference: z.string(),
  votes: z.number().nullable(),
  text: z.string().nullable(),
});
export const crossReferencesSchema = z.array(crossReferenceSchema);

// A place (from Concord). Honesty model: lat/lon/confidence are null for unknown/symbolic.
export const placeSchema = z.object({
  id: z.string(),
  friendly_id: z.string(),
  name: z.string(),
  type: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  confidence: z.string().nullable(),
  confidence_score: z.number().nullable(),
  status: z.string(),
});
export const placesSchema = z.array(placeSchema);

export const placeVerseSchema = z.object({
  book: z.string(),
  chapter: z.number(),
  verse: z.number(),
  reference: z.string(),
});
export const placeVersesSchema = z.array(placeVerseSchema);

export type Book = z.infer<typeof bookSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type ReadAnnotation = z.infer<typeof readAnnotationSchema>;
export type ReadVerse = z.infer<typeof readVerseSchema>;
export type ReadChapter = z.infer<typeof readChapterSchema>;
export type ResolvedReference = z.infer<typeof resolvedReferenceSchema>;
export type CrossReference = z.infer<typeof crossReferenceSchema>;
export type Place = z.infer<typeof placeSchema>;
export type PlaceVerse = z.infer<typeof placeVerseSchema>;

// A ranked Scripture result from Concord's semantic search.
export const semanticResultSchema = z.object({
  book: z.string(),
  chapter: z.number(),
  verse: z.number(),
  reference: z.string(),
  score: z.number(),
  text: z.string().nullable(),
});
export const semanticResultsSchema = z.array(semanticResultSchema);
export type SemanticResult = z.infer<typeof semanticResultSchema>;

// --- Auth (Slice 8) ---

export const userSchema = z.object({
  id: z.number(),
  username: z.string().nullable(),
  is_admin: z.boolean(),
  created_at: z.string(),
});
export const authEnvelopeSchema = z.object({
  user: userSchema,
});
export type User = z.infer<typeof userSchema>;

// Annotation scope (SPEC §2) for the editor's scope picker.
export type ScopeType = "all" | "current" | "subset";
export interface Scope {
  type: ScopeType;
  translations: string[];
}
