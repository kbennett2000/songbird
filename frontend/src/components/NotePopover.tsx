import { Popover } from "@/components/Popover";
import { NOTE_TYPE_LABELS } from "@/lib/notes";
import type { TranslatorNote } from "@/schemas";

interface NotePopoverProps {
  note: TranslatorNote;
  /** The tapped marker button the popover anchors to. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Jump the reader to a note cross-ref — reuses the reader's canonical-coordinate navigation. */
  onJump: (book: string, chapter: number, verse: number) => void;
}

function typeLabel(type: string | null): string {
  if (!type) return "Footnote";
  return NOTE_TYPE_LABELS[type] ?? "Note";
}

/**
 * A floating popover for one translator's note, anchored to its inline marker. Shows the note
 * type, its text (Greek/Hebrew Unicode renders natively), and its cross-references as buttons
 * that jump the reader via the existing canonical navigation. Positioning + dismissal live in
 * the shared {@link Popover} shell.
 */
export function NotePopover({ note, anchor, onClose, onJump }: NotePopoverProps): JSX.Element {
  return (
    <Popover anchor={anchor} onClose={onClose} ariaLabel={`${typeLabel(note.type)} — ${note.reference}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">
          {typeLabel(note.type)}
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
      <p className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100">{note.text}</p>
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
