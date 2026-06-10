import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Popover } from "@/components/Popover";
import { notePreview, readerLink } from "@/lib/notes";
import type { ReadAnnotation } from "@/schemas";

interface AnnotationsPopoverProps {
  /** Every annotation on the tapped marker (≥2 — the single-note case uses AnnotationPopover, or
      in the reader opens the editor directly). All share the marker's in/out-of-scope class. */
  annotations: ReadAnnotation[];
  anchor: HTMLElement;
  onClose: () => void;
  /**
   * Reader case: open this note for editing. When provided, each card is a button that opens it.
   * When omitted (compare case), each card is instead a deep-link back to the reader (read-only).
   */
  onOpen?: (annotation: ReadAnnotation) => void;
}

/** Newest first: created_at DESC, stable. ISO timestamps compare lexicographically. */
function byNewest(a: ReadAnnotation, b: ReadAnnotation): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

const CARD_CLASS =
  "block w-full text-left rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 hover:bg-gray-50 dark:hover:bg-gray-700";

/** The body shared by both card variants: out-of-scope line, one-line preview + chevron, tags. */
function CardBody({ annotation }: { annotation: ReadAnnotation }): JSX.Element {
  const preview = notePreview(annotation.note_markdown);
  return (
    <>
      {!annotation.in_scope && annotation.scope_translations.length > 0 && (
        <p className="mb-1 text-xs italic text-gray-500 dark:text-gray-400">
          Written for {annotation.scope_translations.join(", ")}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            preview ? "text-gray-700 dark:text-gray-200" : "italic text-gray-400 dark:text-gray-500"
          }`}
        >
          {preview || "(empty note)"}
        </span>
        <span aria-hidden className="shrink-0 text-gray-400">
          ›
        </span>
      </div>
      {annotation.tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {annotation.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * A floating popover listing EVERY annotation on a verse — the multi-note case, so none is hidden
 * behind `[0]` (#114). Each note is a calm, bounded card showing a one-line plain-text preview
 * ({@link notePreview} strips the Markdown — never a scary wall of raw `#`/`*`), tappable to open
 * the full note: the editor in the reader, or a reader deep-link in compare (#116). Distinct
 * bordered cards make the breaks between notes obvious in light and dark alike. Shares the
 * {@link Popover} shell, so a long list scrolls inside the popover.
 */
export function AnnotationsPopover({
  annotations,
  anchor,
  onClose,
  onOpen,
}: AnnotationsPopoverProps): JSX.Element {
  const sorted = useMemo(() => [...annotations].sort(byNewest), [annotations]);
  return (
    <Popover anchor={anchor} onClose={onClose} ariaLabel={`${annotations.length} notes on this verse`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          Notes · {annotations.length}
        </span>
        <button
          type="button"
          className="rounded p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <ul className="flex flex-col gap-3">
        {sorted.map((annotation) => (
          <li key={annotation.id}>
            {onOpen ? (
              <button
                type="button"
                className={CARD_CLASS}
                onClick={() => onOpen(annotation)}
                aria-label={`Open note: ${notePreview(annotation.note_markdown) || "(empty note)"}`}
              >
                <CardBody annotation={annotation} />
              </button>
            ) : (
              <Link
                to={readerLink(annotation)}
                className={CARD_CLASS}
                aria-label={`Open note in reader: ${notePreview(annotation.note_markdown) || "(empty note)"}`}
              >
                <CardBody annotation={annotation} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Popover>
  );
}
