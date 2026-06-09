import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { TopNav } from "@/components/TopNav";
import { fetchJourneys } from "@/lib/reader";

const PAGE_SIZE = 50;

/** The curated journeys — a plain paginated list (the endpoint takes no search/filter, just
 * pagination). Each row opens the journey detail (route map + stops). Errors surface (this is a
 * screen's primary content). */
export function JourneysView(): JSX.Element {
  const list = useInfiniteQuery({
    queryKey: ["journeys"],
    queryFn: ({ pageParam }) => fetchJourneys(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.journeys.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const journeys = list.data?.pages.flatMap((p) => p.journeys) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Journeys</h1>
        <p className="mb-4 text-gray-500 dark:text-gray-400">
          Curated Scripture journeys — trace a route stop by stop on the map, each tied to its
          passage. Open one to see its route and stops.
        </p>

        {list.isPending && <p className="text-gray-500 dark:text-gray-400">Loading journeys…</p>}
        {list.isError && (
          <p className="text-red-600 dark:text-red-400">
            Couldn&rsquo;t load journeys (is Concord reachable?).
          </p>
        )}
        {list.data && journeys.length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">No journeys.</p>
        )}

        {journeys.length > 0 && (
          <>
            <p className="mb-2 text-sm text-gray-400 dark:text-gray-500">
              {journeys.length} of {total}
            </p>
            <ul className="flex flex-col gap-2">
              {journeys.map((j) => (
                <li
                  key={j.id}
                  className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                >
                  <Link
                    to={`/journeys/${j.id}`}
                    className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                  >
                    {j.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    {j.scripture}
                    {j.dating && <span> · {j.dating}</span>}
                    <span> · {j.stop_count} stops</span>
                  </p>
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
