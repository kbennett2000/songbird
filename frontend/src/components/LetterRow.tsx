import type { CSSProperties } from "react";

import type { IndexLetter } from "@/lib/letterIndex";

interface LetterRowProps {
  /** The letters the document has, A to Z. */
  letters: IndexLetter[];
  onLetter: (letter: IndexLetter) => void;
}

// On a phone, at most this many letters to a row: 26 in one would be 13 px each.
const PHONE_ROW = 13;

/**
 * A long alphabetical document's way around (v1.8): the letters its headings start with, in a row
 * under the title that never scrolls away, as the reading plan's Month row is. Only the letters it
 * has are offered. A phone gets even rows of at most 13, so each letter is a cell about 32 px
 * wide; from 640 px they share one row. Equal cells that can shrink, so the row never pushes the
 * page sideways.
 */
export function LetterRow({ letters, onLetter }: LetterRowProps): JSX.Element {
  const rows = Math.ceil(letters.length / PHONE_ROW);
  const columns = {
    "--letter-columns": Math.ceil(letters.length / rows),
    "--letter-count": letters.length,
  } as CSSProperties;
  return (
    // Text sizes on the buttons, not the row: the row's 65 characters must match the header's.
    <nav aria-label="Jump to a letter" className="mx-auto mt-2 max-w-prose px-4">
      <ul
        className="grid grid-cols-[repeat(var(--letter-columns),minmax(0,1fr))] gap-y-1 sm:grid-cols-[repeat(var(--letter-count),minmax(0,1fr))]"
        style={columns}
      >
        {letters.map((l) => (
          <li key={l.letter}>
            <button
              type="button"
              className="h-9 w-full rounded text-sm font-semibold text-blue-700 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => onLetter(l)}
            >
              {l.letter}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
