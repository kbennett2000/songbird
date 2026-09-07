import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { DismissMatchingDialog } from "@/components/DismissMatchingDialog";
import { SermonVideoRow } from "@/components/SermonVideoRow";
import { dismissibleCount, patchVideo } from "@/lib/ledgerCache";
import {
  type SermonVideoFilters,
  dismissMatching,
  listSourceVideos,
} from "@/lib/sermonSources";
import type {
  SermonSource,
  SermonSourceVideo,
  SermonSourceVideosPage,
  SermonVideoStatus,
} from "@/schemas";

const PAGE_SIZE = 50;

/** Every state a row can be in, in the order a reader meets them, in the reader's words. The
 * API's vocabulary belongs to the server; this one belongs to the page. */
const STATE_OPTIONS: [SermonVideoStatus, string][] = [
  ["needs_passage", "Needs a passage"],
  ["placed", "Placed"],
  ["skipped", "Skipped"],
  ["dismissed", "Not a sermon"],
  ["already_noted", "Already noted"],
  ["pending", "Waiting"],
];

const FIELD =
  "mt-0.5 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm";

/**
 * The review list (v1.7 sermon sources, spec §8) — what songbird found, and what to do about it.
 *
 * The screen this feature is really for. A church that livestreams every service leaves hundreds
 * of rows here in a single scan, because a dated title names no passage, and they get worked
 * through a few at a time over months. Everything below follows from that number:
 *
 * * **The filter bar comes first**, with a count beside every state, because the first useful act
 *   on a list of hundreds is making it smaller.
 * * **A row that is acted on stays where it is** and grows its undo, rather than vanishing. You
 *   keep your place in the list, the mistake you just made is right there to take back, and
 *   nothing refetches the pages already loaded.
 * * **"Dismiss all N matching"** turns a year of dated livestreams into a filter and one confirm.
 *
 * A list of cards rather than a table, like every other list in the app: five columns do not fit
 * a phone, and this is the page most likely to be used on one.
 */
export function SermonVideoLedger({ sources }: { sources: SermonSource[] }): JSX.Element {
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState<number | "all">("all");
  const [state, setState] = useState<SermonVideoStatus | "all">("all");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  // The typed search and the committed one are separate: only the committed one is in the query
  // key, so the list refetches when you press Enter rather than on every keystroke.
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const filters: SermonVideoFilters = {
    sourceId: sourceId === "all" ? undefined : sourceId,
    status: state === "all" ? undefined : state,
    publishedAfter: after || undefined,
    publishedBefore: before || undefined,
    q: q || undefined,
  };
  const queryKey = ["sermon-source-videos", filters] as const;

  const list = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => listSourceVideos(filters, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.videos.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const bulk = useMutation({
    mutationFn: () => dismissMatching(filters),
    onSuccess: (dismissed) => {
      setConfirmingBulk(false);
      setBulkMessage(
        dismissed === 0
          ? "Nothing to dismiss — those are all placed or still waiting."
          : `Marked ${dismissed} ${dismissed === 1 ? "video" : "videos"} as not a sermon.`,
      );
      // A sweep changes rows wholesale, so this is the one action that refetches rather than
      // patching: there is no place in the list left to keep.
      void queryClient.invalidateQueries({ queryKey: ["sermon-source-videos"] });
    },
    onError: () => setBulkMessage("Couldn't dismiss those. Nothing was changed."),
  });

  const videos = list.data?.pages.flatMap((p) => p.videos) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const counts = list.data?.pages[0]?.counts;
  const filtered = sourceId !== "all" || state !== "all" || after !== "" || before !== "" || q !== "";
  const canDismiss = counts ? dismissibleCount(counts, state) : 0;

  const rowChanged = (updated: SermonSourceVideo, previous: SermonVideoStatus) => {
    setBulkMessage(null);
    queryClient.setQueryData(queryKey, (old: typeof list.data) =>
      patchVideo(old as never, updated, previous, state),
    );
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(draft.trim());
  };

  return (
    <section aria-label="What songbird found" className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        What songbird found
      </h2>

      {/* `flex-wrap` throughout: at phone width these fall into a column rather than overflowing. */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          Source
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value === "all" ? "all" : Number(e.target.value))}
            aria-label="Filter by source"
            /* Capped, because a real playlist title runs to seventy characters and would push the
               row past the edge of a phone. No dark background classes: index.css gives every
               select one, and overriding it is how slice 3's forms stopped matching the app. */
            className={`${FIELD} max-w-[16rem]`}
          >
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          State
          <select
            value={state}
            onChange={(e) => setState(e.target.value as SermonVideoStatus | "all")}
            aria-label="Filter by state"
            className={FIELD}
          >
            <option value="all">Any state</option>
            {/* The count beside each state is what tells you where the work is. It comes from the
                same filtered query as the list, so choosing a source narrows it too. */}
            {STATE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {counts ? `${label} (${counts[value]})` : label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          From
          <input
            type="date"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            aria-label="Published on or after"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
          To
          <input
            type="date"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            aria-label="Published on or before"
            className={FIELD}
          />
        </label>

        <form onSubmit={submitSearch} className="flex items-end gap-2">
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            Title contains
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Search titles"
              placeholder="e.g. Christmas"
              className={FIELD}
            />
          </label>
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
        </form>
      </div>

      {/* Only offered when the filter really would take something, and labelled with that number
          rather than with the number of rows on screen — the sweep never touches a placed row. */}
      {filtered && canDismiss > 0 && (
        <button
          type="button"
          onClick={() => setConfirmingBulk(true)}
          className="mb-3 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Dismiss all {canDismiss} matching
        </button>
      )}

      {bulkMessage !== null && (
        <p role="status" className="mb-3 text-sm text-emerald-700 dark:text-emerald-400">
          {bulkMessage}
        </p>
      )}

      {list.isPending && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}
      {list.isError && (
        <p className="text-red-600 dark:text-red-400">Couldn&rsquo;t load what songbird found.</p>
      )}
      {list.data && videos.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400">
          {filtered
            ? "Nothing matches those filters."
            : "Nothing yet. Press Check all now and songbird will go and look."}
        </p>
      )}

      {videos.length > 0 && (
        <>
          <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
            {videos.length} of {total}
          </p>
          {/* Named, because a row holds lists of its own (the suggested passages), and "the list
              of videos" has to stay something a reader — and a test — can ask for. */}
          <ul aria-label="Videos" className="flex flex-col gap-2">
            {videos.map((v) => (
              <SermonVideoRow key={v.id} video={v} onChanged={rowChanged} />
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

      <DismissMatchingDialog
        open={confirmingBulk}
        count={canDismiss}
        describing={describeFilter(filters, sources)}
        working={bulk.isPending}
        onCancel={() => setConfirmingBulk(false)}
        onConfirm={() => bulk.mutate()}
      />
    </section>
  );
}

/** The filter in words, for the confirm to say out loud. A count on its own is not enough to act
 * on: "312 videos" could be anything, and this is the one action that cannot be undone in one go. */
function describeFilter(filters: SermonVideoFilters, sources: SermonSource[]): string {
  const parts: string[] = [];
  const source = sources.find((s) => s.id === filters.sourceId);
  if (source) parts.push(`from ${source.title}`);
  if (filters.q) parts.push(`with “${filters.q}” in the title`);
  if (filters.publishedAfter && filters.publishedBefore) {
    parts.push(`between ${filters.publishedAfter} and ${filters.publishedBefore}`);
  } else if (filters.publishedAfter) {
    parts.push(`from ${filters.publishedAfter} onwards`);
  } else if (filters.publishedBefore) {
    parts.push(`up to ${filters.publishedBefore}`);
  }
  return parts.join(", ");
}

export type { SermonSourceVideosPage };
