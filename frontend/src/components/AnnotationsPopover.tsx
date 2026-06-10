import { useMemo } from "react";
import { Link } from "react-router-dom";

import { Popover } from "@/components/Popover";
import { readerLink } from "@/lib/notes";
import type { ReadAnnotation } from "@/schemas";

interface AnnotationsPopoverProps {
  /** Every annotation on the tapped marker (≥2 — the single-note case uses AnnotationPopover, or
      in the reader opens the editor directly). All share the marker's in/out-of-scope class. */
  annotations: ReadAnnotation[];
  anchor: HTMLElement;
  onClose: () => void;
  /**
   * Reader case: open this note for editing. When provided, each row gets an "Open" button.
   * When omitted (compare case), each row instead deep-links back to the reader (read-only).
   */
  onOpen?: (annotation: ReadAnnotation) => void;
}

/** Newest first: created_at DESC, stable. ISO timestamps compare lexicographically. */
function byNewest(a: ReadAnnotation, b: ReadAnnotation): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/**
 * A floating popover listing EVERY annotation on a verse — the multi-note case, so none is hidden
 * behind `[0]` (#114). One tap shows the whole stack for the verse; each row reuses the single
 * {@link AnnotationPopover} body (verbatim Markdown — invariant 6, never editor-native JSON — its
 * out-of-scope line and tags). Shares the {@link Popover} shell, so a tall list scrolls inside.
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
      <div className="mb-1 flex items-start justify-between gap-2">
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

      <ul className="flex flex-col">
        {sorted.map((annotation) => (
          <li
            key={annotation.id}
            className="border-t border-gray-100 py-2 first:border-0 first:pt-0"
          >
            {!annotation.in_scope && annotation.scope_translations.length > 0 && (
              <p className="mb-1 text-xs italic text-gray-500 dark:text-gray-400">
                Written for {annotation.scope_translations.join(", ")}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">
              {annotation.note_markdown}
            </p>
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
            <div className="mt-2">
              {onOpen ? (
                <button
                  type="button"
                  className="text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
                  onClick={() => onOpen(annotation)}
                >
                  Open →
                </button>
              ) : (
                <Link
                  to={readerLink(annotation)}
                  className="text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  Open in reader →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
