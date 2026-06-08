import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { PlaceLocation, StatusBadge } from "@/components/PlaceHonesty";
import { TopNav } from "@/components/TopNav";
import { browsePlaces, fetchPlaceTypes } from "@/lib/reader";

const PAGE_SIZE = 50;

// `status` is a fixed enum (Concord's classification), so listing it here is safe — unlike `type`,
// whose vocabulary is derived from Concord (see fetchPlaceTypes) to avoid going stale.
const STATUS_OPTIONS = ["identified", "disputed", "unknown", "symbolic", "multiple"] as const;

export function PlacesView(): JSX.Element {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");

  const typesQuery = useQuery({ queryKey: ["place-types"], queryFn: fetchPlaceTypes });
  const types = typesQuery.data ?? [];

  const list = useInfiniteQuery({
    queryKey: ["places-browse", { type, status, q }],
    queryFn: ({ pageParam }) =>
      browsePlaces({
        type: type || undefined,
        status: status || undefined,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.places.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const places = list.data?.pages.flatMap((p) => p.places) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Places</h1>
        <p className="mb-4 text-gray-500">
          Every place named in Scripture that Concord knows — browse, filter, and open one to see
          where it is (honestly) and the verses that name it.
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <form onSubmit={submitSearch} className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search by name… e.g. Jerusalem"
              aria-label="Search places by name"
              className="rounded border border-gray-300 px-3 py-2"
            />
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              Search
            </button>
          </form>

          <label className="flex flex-col text-xs text-gray-500">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
              className="mt-0.5 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {/* Type filter shows ONLY when Concord surfaced the vocabulary — never a hardcoded list. */}
          {types.length > 0 && (
            <label className="flex flex-col text-xs text-gray-500">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                aria-label="Filter by type"
                className="mt-0.5 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900"
              >
                <option value="">All</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {list.isPending && <p className="text-gray-500">Loading places…</p>}
        {list.isError && (
          <p className="text-red-600">Couldn&rsquo;t load places (is Concord reachable?).</p>
        )}
        {list.data && places.length === 0 && <p className="text-gray-500">No places match.</p>}

        {places.length > 0 && (
          <>
            <p className="mb-2 text-sm text-gray-400">
              {places.length} of {total}
            </p>
            <ul className="flex flex-col gap-2">
              {places.map((place) => (
                <li key={place.id} className="rounded border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/places/${place.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {place.name}
                    </Link>
                    <span className="text-xs text-gray-400">{place.type}</span>
                    <StatusBadge status={place.status} />
                  </div>
                  <div className="mt-0.5">
                    <PlaceLocation place={place} />
                  </div>
                </li>
              ))}
            </ul>

            {list.hasNextPage && (
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="mt-4 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
