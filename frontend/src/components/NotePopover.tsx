import { NoteMarkdown } from "@/components/NoteMarkdown";
import { Popover } from "@/components/Popover";
import type { ShownNote } from "@/lib/borrowedNotes";
import type { NoteLook } from "@/lib/noteLooks";
import { noteKindLabel } from "@/lib/notes";

interface NotePopoverProps {
  note: ShownNote;
  /** The Bible the note came from ("EMB"): the one being read, or the one it was borrowed from. */
  source: string;
  /** That Bible's look (`noteLook`), the same one its markers wear. */
  look: NoteLook;
  /** The tapped marker button the popover anchors to. */
  anchor: HTMLElement;
  onClose: () => void;
  /**
   * Jump the reader to a passage — a cross-ref, or a `ref:` link in a Markdown note (`verse` null
   * opens a chapter at its top). Reuses the reader's canonical-coordinate navigation.
   */
  onJump: (book: string, chapter: number, verse: number | null) => void;
}

/**
 * A floating popover for one note, anchored to its inline marker. Shows the note's kind (the
 * source's own label when Concord sends one), its title and the passages it covers, its text —
 * Markdown rendered when the note is Markdown, with `ref:` links that jump, else plain text
 * (Greek/Hebrew Unicode renders natively) — and its cross-references as buttons that jump the
 * reader via the existing canonical navigation. Positioning, dismissal and scrolling a long note
 * live in the shared {@link Popover} shell; the kind/close row stays pinned while it scrolls. A
 * note borrowed from another Bible names it ("From EMB", the code on its checkbox) and quotes
 * that Bible's words it's about, since its marker in this translation is a best-guess placement.
 * Every note carries its Bible's code in the pinned row, in that Bible's look, so the note view
 * matches the marker that opened it.
 */
export function NotePopover({
  note,
  source,
  look,
  anchor,
  onClose,
  onJump,
}: NotePopoverProps): JSX.Element {
  const kind = noteKindLabel(note);
  const passages = note.passages ?? [];
  return (
    <Popover anchor={anchor} onClose={onClose} ariaLabel={`${kind} — ${note.reference}`}>
      <div className="sticky -top-3 z-10 -mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 bg-white dark:bg-gray-800 px-3 pb-1 pt-3">
        <span className="flex items-center gap-2">
          <span
            data-note-look={look.id}
            className={`shrink-0 font-mono text-xs font-semibold ${look.chip}`}
          >
            {source}
          </span>
          <span className={`text-xs font-semibold uppercase tracking-wide ${look.eyebrow}`}>
            {kind}
          </span>
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
      {note.borrowed && (
        <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
          From {note.borrowed.from}
          {note.borrowed.phrase && (
            <>
              {" "}
              · {note.borrowed.from} reads &ldquo;
              <span className="italic">{note.borrowed.phrase}</span>
              &rdquo;
            </>
          )}
        </p>
      )}
      {note.title && (
        <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-50">{note.title}</h3>
      )}
      {passages.length > 0 && (
        <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">
          Covers {passages.map((p) => p.reference).join("; ")}
        </p>
      )}
      {note.text_format === "markdown" ? (
        <NoteMarkdown text={note.text} onJump={onJump} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">
          {note.text}
        </p>
      )}
      {note.cross_references.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
          {note.cross_references.map((ref) => (
            <li key={`${ref.to_book}-${ref.to_chapter}-${ref.to_verse_start}`}>
              <button
                type="button"
                className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                onClick={() => onJump(ref.to_book, ref.to_chapter, ref.to_verse_start)}
              >
                → {ref.reference}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
