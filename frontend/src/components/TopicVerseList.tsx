import { useQuery } from "@tanstack/react-query";

import { fetchTopicVerses } from "@/lib/reader";

interface TopicVerseListProps {
  topicId: string;
  translation: string;
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** The verses curated under a topic (with text), each jump-able. Shared by the reader's
 * `VerseTopics` drill-in panel and the standalone `TopicDetailView` browse screen — the caller
 * supplies the heading/back affordances and decides what a jump means via `onJump`. */
export function TopicVerseList({ topicId, translation, onJump }: TopicVerseListProps): JSX.Element {
  const query = useQuery({
    queryKey: ["topic-verses", topicId, translation],
    queryFn: () => fetchTopicVerses(topicId, translation),
  });

  if (query.isPending)
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading verses…</p>;
  if (query.isError)
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Couldn&rsquo;t load (is Concord reachable?).
      </p>
    );
  if (query.data.length === 0)
    return <p className="text-sm text-gray-500 dark:text-gray-400">No verses for this topic.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((v) => (
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
