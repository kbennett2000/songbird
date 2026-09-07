import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";

import { formatEventDate } from "@/lib/notes";
import { formatVideoLength, listSourceVideos, sermonDay, watchUrl } from "@/lib/sermonSources";
import type { SermonSource, SermonSourceVideo, SermonVideoStatus } from "@/schemas";

const PAGE_SIZE = 50;

/** Every state a row can be in, in the order a reader meets them, in the reader's words. The
 * API's vocabulary belongs to the server; this one belongs to the page. */
const STATE_OPTIONS: [SermonVideoStatus, string][] = [
  ["pending", "Waiting"],
  ["needs_passage", "Needs a passage"],
  ["placed", "Placed"],
  ["skipped", "Skipped"],
  ["already_noted", "Already noted"],
  ["dismissed", "Not a sermon"],
];
const STATE_LABEL = new Map(STATE_OPTIONS);

/** Why a video was skipped, in words rather than field names. */
const SKIP_REASON: Record<"too_short" | "live_excluded", string> = {
  too_short: "shorter than this source's minimum",
  live_excluded: "a livestream, and this source leaves those out",
};

function LedgerRow({ video }: { video: SermonSourceVideo }): JSX.Element {
  return (
    <li className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      {/* `break-words`: a YouTube title can run a hundred characters with nowhere to wrap. */}
      <p className="break-words font-medium text-gray-900 dark:text-gray-100">{video.title}</p>

      {/* Each fact is its own span so a phone has somewhere to break the line, and the separators
          are aria-hidden so a screen reader doesn't read "middle dot" four times a row. */}
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-gray-500 dark:text-gray-400">
        {/* The day the sermon happened, which for a stream is when it STARTED — that is what the
            church's own page says, and what `published_at` alone gets wrong by a day. Parsed part
            by part, never through `new Date()`: these timestamps arrive without a timezone, so
            the browser would read them as local and show the day before to anyone west of UTC. */}
        <span>{formatEventDate(sermonDay(video))}</span>
        <span aria-hidden="true">·</span>
        <span>{formatVideoLength(video.duration_seconds)}</span>
        <span aria-hidden="true">·</span>
        <span className="text-gray-700 dark:text-gray-200">
          {STATE_LABEL.get(video.status) ?? video.status}
        </span>
        {video.skip_reason !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{SKIP_REASON[video.skip_reason]}</span>
          </>
        )}
      </p>

      <p className="mt-0.5 break-words text-sm text-gray-500 dark:text-gray-400">
        {video.source_title}
      </p>

      <a
        href={watchUrl(video.video_id)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
      >
        Watch on YouTube
      </a>
      {/* The place / dismiss / note-it-anyway controls attach here. */}
    </li>
  );
}

/**
 * What songbird found (v1.7 sermon sources, spec §8) — read-only for now.
 *
 * A list of cards rather than a table, like every other list in the app: five columns do not fit a
 * phone. Filters are local to this component and its data is its own query, so refreshing it after
 * a check is a cache invalidation rather than a prop threaded down from the page.
 *
 * Its own file because the slice that adds place / dismiss / restore attaches all of them to a row
 * here, and because the Sources page is long enough already.
 */
export function SermonVideoLedger({ sources }: { sources: SermonSource[] }): JSX.Element {
  const [sourceId, setSourceId] = useState<number | "all">("all");
  const [state, setState] = useState<SermonVideoStatus | "all">("all");

  const list = useInfiniteQuery({
    queryKey: ["sermon-source-videos", { sourceId, state }],
    queryFn: ({ pageParam }) =>
      listSourceVideos({
        sourceId: sourceId === "all" ? undefined : sourceId,
        status: state === "all" ? undefined : state,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.videos.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const videos = list.data?.pages.flatMap((p) => p.videos) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = sourceId !== "all" || state !== "all";

  return (
    <section aria-label="What songbird found" className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        What songbird found
      </h2>

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
            className="mt-0.5 max-w-[16rem] rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm"
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
            className="mt-0.5 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-sm"
          >
            <option value="all">Any state</option>
            {STATE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.isPending && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}
      {list.isError && (
        <p className="text-red-600 dark:text-red-400">
          Couldn&rsquo;t load what songbird found.
        </p>
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
          <ul className="flex flex-col gap-2">
            {videos.map((v) => (
              <LedgerRow key={v.id} video={v} />
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
    </section>
  );
}
