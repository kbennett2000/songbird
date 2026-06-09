import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { PlaceLocation, StatusBadge } from "@/components/PlaceHonesty";
import { TopNav } from "@/components/TopNav";
import { ApiError } from "@/lib/api";
import { fetchPlace, fetchPlaceJourneys, fetchPlaceVerses } from "@/lib/reader";

export function PlaceDetailView(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();

  const placeQuery = useQuery({
    queryKey: ["place", id],
    queryFn: () => fetchPlace(id),
    retry: false,
  });
  const versesQuery = useQuery({
    queryKey: ["place-verses", id],
    queryFn: () => fetchPlaceVerses(id),
    enabled: placeQuery.isSuccess,
  });
  const journeysQuery = useQuery({
    queryKey: ["place-journeys", id],
    queryFn: () => fetchPlaceJourneys(id),
    enabled: placeQuery.isSuccess,
  });

  const notFound = placeQuery.error instanceof ApiError && placeQuery.error.status === 404;
  const place = placeQuery.data;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        <Link to="/places" className="text-sm text-blue-700 dark:text-blue-400 hover:underline">
          ← All places
        </Link>
        {placeQuery.isPending && <p className="text-gray-500 dark:text-gray-400">Loading place…</p>}

        {notFound && (
          <p className="text-gray-500 dark:text-gray-400">That place doesn&rsquo;t exist.</p>
        )}
        {placeQuery.isError && !notFound && (
          <p className="text-red-600 dark:text-red-400">
            Couldn&rsquo;t load this place (is Concord reachable?).
          </p>
        )}

        {place && (
          <>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{place.name}</h1>
              <StatusBadge status={place.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{place.type}</p>
            {place.modern_name && (
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Modern name: <span className="font-medium">{place.modern_name}</span>
              </p>
            )}
            <div className="mt-2">
              <PlaceLocation place={place} />
            </div>

            <h2 className="mb-2 mt-6 text-lg font-semibold">
              Verses{" "}
              <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                ({place.verse_count})
              </span>
            </h2>
            {versesQuery.isPending && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading verses…</p>
            )}
            {versesQuery.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">Couldn&rsquo;t load verses.</p>
            )}
            {versesQuery.data && versesQuery.data.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No verses name this place.</p>
            )}
            {versesQuery.data && versesQuery.data.length > 0 && (
              <ul className="flex flex-col gap-2">
                {versesQuery.data.map((v) => (
                  <li
                    key={`${v.book}-${v.chapter}-${v.verse}`}
                    className="flex items-center gap-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                  >
                    <span className="font-medium">{v.reference}</span>
                    <Link
                      to={`/read?book=${v.book}&chapter=${v.chapter}&verse=${v.verse}`}
                      className="ml-auto text-sm text-blue-700 dark:text-blue-400 hover:underline"
                    >
                      Open in reader
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <h2 className="mb-2 mt-6 text-lg font-semibold">Journeys through here</h2>
            {journeysQuery.isPending && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading journeys…</p>
            )}
            {journeysQuery.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Couldn&rsquo;t load journeys.
              </p>
            )}
            {journeysQuery.data && journeysQuery.data.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No journeys pass through here.
              </p>
            )}
            {journeysQuery.data && journeysQuery.data.length > 0 && (
              <ul className="flex flex-col gap-2">
                {journeysQuery.data.map((j) => (
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
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                      {j.scripture}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
