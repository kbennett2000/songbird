import type { TopicVerse } from "@/schemas";

interface VerseRefListProps {
  /** Canonical verse rows (reference + optional text). `TopicVerse` and `StrongsVerse` share this
   * shape, so this renders both the topic drill-in and the Strong's concordance. */
  verses: TopicVerse[];
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** A presentational list of jump-able verse rows (no fetching). The caller owns the query and its
 * pending/error/empty states and passes the loaded verses here. */
export function VerseRefList({ verses, onJump }: VerseRefListProps): JSX.Element {
  return (
    <ul className="flex flex-col gap-2">
      {verses.map((v) => (
        <li key={`${v.book}-${v.chapter}-${v.verse}`}>
          <button
            type="button"
            className="w-full rounded border border-gray-200 dark:border-gray-700 p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => onJump(v.book, v.chapter, v.verse)}
          >
            <span className="block font-medium text-blue-700 dark:text-blue-400">
              {v.reference}
            </span>
            {v.text && (
              <span className="mt-0.5 block text-sm text-gray-600 dark:text-gray-300">
                {v.text}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
