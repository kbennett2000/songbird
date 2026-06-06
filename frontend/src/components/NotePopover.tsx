import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { TranslatorNote } from "@/schemas";

interface NotePopoverProps {
  note: TranslatorNote;
  /** The tapped marker button the popover anchors to. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Jump the reader to a note cross-ref — reuses the reader's canonical-coordinate navigation. */
  onJump: (book: string, chapter: number, verse: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  tn: "Translator’s note",
  sn: "Study note",
  tc: "Text-critical note",
  map: "Map note",
};

function typeLabel(type: string | null): string {
  if (!type) return "Footnote";
  return TYPE_LABELS[type] ?? "Note";
}

/**
 * A floating popover for one translator's note, anchored to its inline marker. Shows the note
 * type, its text (Greek/Hebrew Unicode renders natively), and its cross-references as buttons
 * that jump the reader via the existing canonical navigation. Closes on Esc, outside-click,
 * page scroll, or resize. Self-contained — no popover dependency (songbird stays lean).
 */
export function NotePopover({ note, anchor, onClose, onJump }: NotePopoverProps): JSX.Element {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Position relative to the marker: below if there's room, else above; clamped to the viewport.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 6;
    const left = Math.min(Math.max(rect.left, margin), Math.max(margin, vw - pop.offsetWidth - margin));
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    if (spaceBelow >= Math.min(pop.offsetHeight, 160) || spaceBelow >= spaceAbove) {
      setPos({ top: rect.bottom + gap, left, maxHeight: spaceBelow });
    } else {
      const maxHeight = spaceAbove;
      setPos({ top: rect.top - gap - Math.min(pop.offsetHeight, maxHeight), left, maxHeight });
    }
  }, [anchor, note]);

  // Dismiss on Esc, outside-click, page scroll, or resize.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    // Dismiss when an OUTSIDE surface scrolls (reader/page) so the popover never drifts from
    // its anchor — but let the note scroll its own overflow content. `capture: true` is needed
    // to catch scrolls from any scroll container; that also delivers the popover's own scroll
    // events here, so we ignore scrolls that originate inside it.
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label={`${typeLabel(note.type)} — ${note.reference}`}
      className="fixed z-40 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-xl"
      style={
        pos
          ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
          : { top: 0, left: 0, visibility: "hidden" }
      }
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-violet-700">
          {typeLabel(note.type)}
        </span>
        <button
          type="button"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="whitespace-pre-wrap text-gray-800">{note.text}</p>
      {note.cross_references.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
          {note.cross_references.map((ref) => (
            <li key={`${ref.to_book}-${ref.to_chapter}-${ref.to_verse_start}`}>
              <button
                type="button"
                className="font-medium text-blue-700 hover:underline"
                onClick={() => onJump(ref.to_book, ref.to_chapter, ref.to_verse_start)}
              >
                → {ref.reference}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
