import { useQuery } from "@tanstack/react-query";

import { fetchCrossReferences } from "@/lib/reader";

interface CrossReferencesProps {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** A verse's cross-references — sourced entirely from Concord (TSK). Each row jumps the reader
 * to that verse, reusing the canonical-coordinate navigation (no re-parsing). */
export function CrossReferences({
  book,
  chapter,
  verse,
  translation,
  onJump,
}: CrossReferencesProps): JSX.Element {
  const query = useQuery({
    queryKey: ["cross-references", translation, book, chapter, verse],
    queryFn: () => fetchCrossReferences(book, chapter, verse, translation),
  });

  if (query.isPending) return <p className="text-sm text-gray-500">Loading cross-references…</p>;
  if (query.isError)
    return <p className="text-sm text-red-600">Couldn&rsquo;t load (is Concord reachable?).</p>;
  if (query.data.length === 0)
    return <p className="text-sm text-gray-500">No cross-references for this verse.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((ref) => (
        <li key={`${ref.book}-${ref.chapter}-${ref.verse_start}`}>
          <button
            type="button"
            className="w-full rounded border border-gray-200 p-2 text-left hover:bg-gray-50"
            onClick={() => onJump(ref.book, ref.chapter, ref.verse_start)}
          >
            <span className="flex items-baseline gap-2">
              <span className="font-medium text-blue-700">{ref.reference}</span>
              {ref.votes !== null && (
                <span className="text-xs text-gray-400">{ref.votes} votes</span>
              )}
            </span>
            {ref.text && <span className="mt-0.5 block text-sm text-gray-600">{ref.text}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
