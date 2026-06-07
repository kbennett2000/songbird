import type { Book } from "@/schemas";

/** The canonical anchor fields both annotations and sermon notes carry. */
export interface NoteAnchor {
  book_usfm: string;
  start_chapter: number;
  start_verse: number;
  end_chapter: number;
  end_verse: number;
}

/** Strip the lightest Markdown noise for a one-line preview. */
export function notePreview(markdown: string): string {
  const plain = markdown
    .replace(/[#*_`>-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

/**
 * A friendly "Book c:v" (or "Book c:v–c:v" for a range) from a canonical anchor + the
 * already-fetched books list. Concord-free: the book name comes from the books list, falling
 * back to the USFM code songbird stores when it isn't loaded.
 */
export function noteReference(a: NoteAnchor, booksById: Map<string, Book>): string {
  const name = booksById.get(a.book_usfm)?.name ?? a.book_usfm;
  const span =
    a.start_chapter === a.end_chapter && a.start_verse === a.end_verse
      ? `${a.start_chapter}:${a.start_verse}`
      : `${a.start_chapter}:${a.start_verse}–${a.end_chapter}:${a.end_verse}`;
  return `${name} ${span}`;
}

/**
 * The reader deep-link for a note's anchor — the single home of the reader path shape. The
 * reader lives at /read and reads ?book=&chapter=&verse= to scroll-to + highlight the verse.
 */
export function readerLink(a: NoteAnchor): string {
  return `/read?book=${a.book_usfm}&chapter=${a.start_chapter}&verse=${a.start_verse}`;
}
