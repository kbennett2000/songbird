import { useInfiniteQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { TopNav } from "@/components/TopNav";
import { fetchTopics } from "@/lib/reader";

const PAGE_SIZE = 50;

/** Browse Concord's curated topical index — search by name, filter by section, paginate, and open
 * a topic to read its verses. Errors surface (this is a screen's primary content). */
export function TopicsView(): JSX.Element {
  const [draftQ, setDraftQ] = useState("");
  const [draftSection, setDraftSection] = useState("");
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");

  const list = useInfiniteQuery({
    queryKey: ["topics-browse", { q, section }],
    queryFn: ({ pageParam }) =>
      fetchTopics({
        q: q || undefined,
        section: section || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.topics.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const topics = list.data?.pages.flatMap((p) => p.topics) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  // Concord exposes no section vocabulary, so the section filter is a free-text box (not a select);
  // both it and the search term apply on submit.
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(draftQ.trim());
    setSection(draftSection.trim());
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Topics</h1>
        <p className="mb-4 text-gray-500 dark:text-gray-400">
          Concord&rsquo;s curated topical index — what Scripture says about a theme. Search, filter
          by section, and open a topic to read its verses.
        </p>

        <form onSubmit={submitSearch} className="mb-4 flex flex-wrap items-end gap-3">
          <input
            type="text"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder="Search by name… e.g. forgiveness"
            aria-label="Search topics by name"
            className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2"
          />
          <input
            type="text"
            value={draftSection}
            onChange={(e) => setDraftSection(e.target.value)}
            placeholder="Section… e.g. God"
            aria-label="Filter by section"
            className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
        </form>

        {list.isPending && <p className="text-gray-500 dark:text-gray-400">Loading topics…</p>}
        {list.isError && (
          <p className="text-red-600 dark:text-red-400">
            Couldn&rsquo;t load topics (is Concord reachable?).
          </p>
        )}
        {list.data && topics.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">No topics match.</p>
        )}

        {topics.length > 0 && (
          <>
            <p className="mb-2 text-sm text-gray-400 dark:text-gray-500">
              {topics.length} of {total}
            </p>
            <ul className="flex flex-col gap-2">
              {topics.map((topic) => (
                <li
                  key={topic.id}
                  className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                >
                  <Link
                    to={`/topics/${topic.id}`}
                    className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {topic.name}
                  </Link>
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                    {topic.section}
                  </span>
                </li>
              ))}
            </ul>

            {list.hasNextPage && (
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="mt-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
