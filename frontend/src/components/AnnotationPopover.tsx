import { Link } from "react-router-dom";

import { Popover } from "@/components/Popover";
import type { ReadAnnotation } from "@/schemas";

interface AnnotationPopoverProps {
  /** The annotation to display, with its `in_scope` flag for the column's translation. */
  annotation: ReadAnnotation;
  /** The tapped marker button the popover anchors to. */
  anchor: HTMLElement;
  onClose: () => void;
}

/**
 * A read-only popover for one annotation, anchored to its marker in the compare view. Shows the
 * note's Markdown verbatim (invariant 6 — the note IS Markdown; we never render editor-native
 * JSON), a scope line when the note was written for other translations, its tags, and a deep-link
 * back to the reader for editing. Editing lives in the reader, not here. Positioning + dismissal
 * come from the shared {@link Popover} shell.
 */
export function AnnotationPopover({
  annotation,
  anchor,
  onClose,
}: AnnotationPopoverProps): JSX.Element {
  // The canonical anchor → a reader deep-link the reader already honours (?book=&chapter=&verse=).
  const readerHref = `/?book=${encodeURIComponent(annotation.book_usfm)}&chapter=${annotation.start_chapter}&verse=${annotation.start_verse}`;
  return (
    <Popover anchor={anchor} onClose={onClose} ariaLabel={`Note on ${annotation.book_usfm} ${annotation.start_chapter}:${annotation.start_verse}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Note</span>
        <button
          type="button"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {!annotation.in_scope && annotation.scope_translations.length > 0 && (
        <p className="mb-1 text-xs italic text-gray-500">
          Written for {annotation.scope_translations.join(", ")}
        </p>
      )}
      <p className="whitespace-pre-wrap break-words text-gray-800">{annotation.note_markdown}</p>
      {annotation.tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {annotation.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 border-t border-gray-100 pt-2">
        <Link to={readerHref} className="text-sm font-medium text-blue-700 hover:underline">
          Open in reader →
        </Link>
      </div>
    </Popover>
  );
}
