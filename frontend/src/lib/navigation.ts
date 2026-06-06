import type { Book } from "@/schemas";

export interface ChapterRef {
  book: string;
  chapter: number;
}

/** Canon order + chapter counts come from Concord's `/v1/books` — never hardcoded here. */
function byOrder(books: Book[]): Book[] {
  return [...books].sort((a, b) => a.canonical_order - b.canonical_order);
}

/**
 * The chapter after (book, chapter), rolling into the next book at a book's end. Returns null
 * at the canon's end (last chapter of the last book) — the caller clamps.
 */
export function nextChapter(books: Book[], book: string, chapter: number): ChapterRef | null {
  const current = books.find((b) => b.id === book);
  if (!current) return null;
  if (current.chapter_count !== null && chapter < current.chapter_count) {
    return { book, chapter: chapter + 1 };
  }
  const next = byOrder(books).find((b) => b.canonical_order > current.canonical_order);
  return next ? { book: next.id, chapter: 1 } : null;
}

/**
 * The chapter before (book, chapter), rolling into the previous book's last chapter at a
 * book's start. Returns null at the canon's start (Genesis 1) — the caller clamps.
 */
export function prevChapter(books: Book[], book: string, chapter: number): ChapterRef | null {
  const current = books.find((b) => b.id === book);
  if (!current) return null;
  if (chapter > 1) return { book, chapter: chapter - 1 };
  const prev = [...byOrder(books)]
    .reverse()
    .find((b) => b.canonical_order < current.canonical_order);
  return prev ? { book: prev.id, chapter: prev.chapter_count ?? 1 } : null;
}
