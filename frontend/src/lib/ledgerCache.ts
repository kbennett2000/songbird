import type { InfiniteData } from "@tanstack/react-query";

import type {
  SermonSourceCounts,
  SermonSourceVideo,
  SermonSourceVideosPage,
  SermonVideoStatus,
} from "@/schemas";

/**
 * Redrawing one row of the review list without refetching the rest (spec §8).
 *
 * The list this serves is hundreds of rows long and gets worked through over months, fifty rows at
 * a time. Invalidating after every tap would refetch every page loaded so far and throw away the
 * reader's place in the list — so the row acted on is patched into the cache instead, and stays
 * exactly where it was with its undo control on it.
 *
 * The tallies have to move with it. They are what puts a number beside each state in the filter
 * bar and what "Dismiss all N matching" promises, so a stale one is a button telling a lie.
 */

function bump(counts: SermonSourceCounts, status: SermonVideoStatus, by: number): void {
  // `Math.max(0, …)`: a count can only go wrong here if the page arrived mid-scan, and a negative
  // number on screen would be worse than a slightly stale one.
  counts[status] = Math.max(0, counts[status] + by);
}

export function patchVideo(
  data: InfiniteData<SermonSourceVideosPage> | undefined,
  updated: SermonSourceVideo,
  previous: SermonVideoStatus,
  statusFilter: SermonVideoStatus | "all",
): InfiniteData<SermonSourceVideosPage> | undefined {
  if (data === undefined) return data;
  const moved = previous !== updated.status;
  // A row that has just stopped matching the chosen state is still on screen — that is the point
  // — but the server would no longer count it, so `total` has to drop or "50 of 351" would keep
  // claiming a row that is now visibly something else.
  const left = moved && statusFilter !== "all" && previous === statusFilter;

  return {
    ...data,
    pages: data.pages.map((page) => {
      const counts = { ...page.counts };
      if (moved) {
        bump(counts, previous, -1);
        bump(counts, updated.status, 1);
      }
      return {
        ...page,
        counts,
        total: left ? Math.max(0, page.total - 1) : page.total,
        videos: page.videos.map((v) => (v.id === updated.id ? updated : v)),
      };
    }),
  };
}

/**
 * How many of the rows this filter selects the bulk dismiss would actually take.
 *
 * Not `total`, and the difference matters: the sweep never touches a row that has notes behind it
 * or one still waiting to be read, so a button labelled with `total` would promise a number the
 * server would not deliver. With a state chosen, it is that state's own count — or nothing at all,
 * when the state is one the sweep cannot touch.
 */
export function dismissibleCount(
  counts: SermonSourceCounts,
  statusFilter: SermonVideoStatus | "all",
): number {
  if (statusFilter === "all") return counts.needs_passage + counts.skipped;
  if (statusFilter === "needs_passage" || statusFilter === "skipped") return counts[statusFilter];
  return 0;
}
