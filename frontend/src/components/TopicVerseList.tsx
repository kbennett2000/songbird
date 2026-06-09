import { useQuery } from "@tanstack/react-query";

import { VerseRefList } from "@/components/VerseRefList";
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

  return <VerseRefList verses={query.data} onJump={onJump} />;
}
