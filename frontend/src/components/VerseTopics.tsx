import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { TopicVerseList } from "@/components/TopicVerseList";
import { fetchVerseTopics } from "@/lib/reader";
import type { TopicSummary } from "@/schemas";

interface VerseTopicsProps {
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** A verse's topics — Concord's curated topical index (songbird owns none). Two levels in one
 * panel: the verse's topics, then (drilling into one) that topic's verses, each jump-able back
 * into the reader. User-invoked, so an outage shows an inline error (unlike the silent headings
 * overlay). */
export function VerseTopics({
  book,
  chapter,
  verse,
  translation,
  onJump,
}: VerseTopicsProps): JSX.Element {
  const [selectedTopic, setSelectedTopic] = useState<TopicSummary | null>(null);

  if (selectedTopic) {
    // A `see_also` topic is a redirect — drill into its target's verses.
    return (
      <div className="flex flex-col gap-3">
        <div>
          <button
            type="button"
            className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
            onClick={() => setSelectedTopic(null)}
          >
            ← Topics
          </button>
          <h3 className="mt-1 font-semibold">{selectedTopic.name}</h3>
        </div>
        <TopicVerseList
          topicId={selectedTopic.see_also ?? selectedTopic.id}
          translation={translation}
          onJump={onJump}
        />
      </div>
    );
  }

  return <TopicList book={book} chapter={chapter} verse={verse} onSelect={setSelectedTopic} />;
}

/** Level 1 — the topics this verse appears under. */
function TopicList({
  book,
  chapter,
  verse,
  onSelect,
}: {
  book: string;
  chapter: number;
  verse: number;
  onSelect: (topic: TopicSummary) => void;
}): JSX.Element {
  const query = useQuery({
    queryKey: ["verse-topics", book, chapter, verse],
    queryFn: () => fetchVerseTopics(book, chapter, verse),
  });

  if (query.isPending)
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading topics…</p>;
  if (query.isError)
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Couldn&rsquo;t load (is Concord reachable?).
      </p>
    );
  if (query.data.length === 0)
    return <p className="text-sm text-gray-500 dark:text-gray-400">No topics for this verse.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((topic) => (
        <li key={topic.id}>
          <button
            type="button"
            className="w-full rounded border border-gray-200 dark:border-gray-700 p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => onSelect(topic)}
          >
            <span className="block font-medium text-blue-700 dark:text-blue-400">{topic.name}</span>
            <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">
              {topic.section}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
