import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { JourneyMap } from "@/components/JourneyMap";
import { StatusBadge } from "@/components/PlaceHonesty";
import { TopNav } from "@/components/TopNav";
import { ApiError } from "@/lib/api";
import { fetchJourney, resolveReference } from "@/lib/reader";

/** A curated journey: its metadata, the one-reconstruction note (a prominent honesty callout), the
 * route map (located stops as an ordered numbered line), and the ordered stop list (located AND
 * unlocated — unlocated are listed but never mapped). A stop's scripture reference jumps to the
 * reader: we resolve the human reference to canonical coords (mirroring ReaderView), then navigate. */
export function JourneyDetailView(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const journeyQuery = useQuery({
    queryKey: ["journey", id],
    queryFn: () => fetchJourney(id),
    retry: false,
  });

  const jumpMutation = useMutation({
    mutationFn: (reference: string) => resolveReference(reference),
    onSuccess: (r) => {
      const verse = r.verse !== null ? `&verse=${r.verse}` : "";
      navigate(`/read?book=${r.book}&chapter=${r.chapter}${verse}`);
    },
  });
  const jump = (reference: string) => jumpMutation.mutate(reference);

  const notFound = journeyQuery.error instanceof ApiError && journeyQuery.error.status === 404;
  const journey = journeyQuery.data;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        <Link to="/journeys" className="text-sm text-blue-700 dark:text-blue-400 hover:underline">
          ← All journeys
        </Link>
        {journeyQuery.isPending && (
          <p className="text-gray-500 dark:text-gray-400">Loading journey…</p>
        )}

        {notFound && (
          <p className="text-gray-500 dark:text-gray-400">That journey doesn&rsquo;t exist.</p>
        )}
        {journeyQuery.isError && !notFound && (
          <p className="text-red-600 dark:text-red-400">
            Couldn&rsquo;t load this journey (is Concord reachable?).
          </p>
        )}

        {journey && (
          <>
            <h1 className="text-2xl font-bold tracking-tight">{journey.name}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {journey.scripture}
              {journey.dating && <span> · {journey.dating}</span>}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{journey.source}</p>

            {/* The one-reconstruction note — a prominent honesty callout, not a footnote. */}
            <p
              role="note"
              className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
            >
              {journey.note}
            </p>

            <div className="mt-4">
              <JourneyMap stops={journey.stops} onJump={jump} />
            </div>

            {jumpMutation.isError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Couldn&rsquo;t open that reference (is Concord reachable?).
              </p>
            )}

            <h2 className="mb-2 mt-6 text-lg font-semibold">Stops</h2>
            <ol className="flex flex-col gap-2">
              {journey.stops.map((stop) => {
                const unlocated = stop.latitude === null || stop.longitude === null;
                return (
                  <li
                    key={stop.ordinal}
                    className="flex items-start gap-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                      {stop.ordinal}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{stop.name ?? stop.place_id}</span>
                        {stop.status && <StatusBadge status={stop.status} />}
                        {stop.confidence && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {stop.confidence} confidence
                          </span>
                        )}
                        {unlocated && (
                          <span className="text-xs italic text-gray-400 dark:text-gray-500">
                            Location unknown
                          </span>
                        )}
                      </div>
                      {stop.reference && (
                        /* present → jumps; resolved to canonical coords then navigates */ <button
                          type="button"
                          className="mt-1 text-sm text-blue-700 dark:text-blue-400 hover:underline"
                          onClick={() => jump(stop.reference as string)}
                        >
                          {stop.reference}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}
