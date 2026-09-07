import { apiRequest } from "@/lib/api";
import {
  type SermonCheckQueued,
  type SermonSource,
  type SermonSourceVideo,
  type SermonSourceVideosPage,
  type SermonSourcesStatus,
  type SermonVideoStatus,
  sermonCheckQueuedSchema,
  sermonSourceSchema,
  sermonSourceVideoSchema,
  sermonSourceVideosPageSchema,
  sermonSourcesListSchema,
  sermonSourcesStatusSchema,
  sermonVideosDismissedSchema,
} from "@/schemas";

/**
 * Sermon sources (v1.7): the YouTube channels and playlists songbird collects sermons from.
 *
 * Adding one resolves the pasted link through YouTube server-side — the browser never talks to
 * YouTube and never sees the API key.
 */

/** What a new source is created from. Everything else — the ids, the title — comes from YouTube. */
export interface SermonSourceInput {
  url: string;
  tags: string[];
  include_live: boolean;
  /** Null means "follow the app-wide default", which is what an empty field sends. */
  min_minutes: number | null;
}

/**
 * What an edit can change. The URL and the identity it resolved to are absent on purpose: to
 * point songbird at a different channel you delete this source and add the new one.
 *
 * Every field is sent on every edit, `min_minutes` included, so a null there reaches the server
 * as an explicit null — which is how an override is cleared back to the default. Omitting it
 * would mean "leave it alone" and the field could never be emptied.
 */
export interface SermonSourceEdit {
  tags: string[];
  enabled: boolean;
  include_live: boolean;
  min_minutes: number | null;
}

export async function fetchSourcesStatus(): Promise<SermonSourcesStatus> {
  const data = await apiRequest<unknown>("GET", "/sermon-sources/status");
  return sermonSourcesStatusSchema.parse(data);
}

export async function listSources(): Promise<SermonSource[]> {
  const data = await apiRequest<unknown>("GET", "/sermon-sources");
  return sermonSourcesListSchema.parse(data);
}

export async function createSource(input: SermonSourceInput): Promise<SermonSource> {
  const data = await apiRequest<unknown>("POST", "/sermon-sources", input);
  return sermonSourceSchema.parse(data);
}

export async function updateSource(id: number, edit: SermonSourceEdit): Promise<SermonSource> {
  const data = await apiRequest<unknown>("PATCH", `/sermon-sources/${id}`, edit);
  return sermonSourceSchema.parse(data);
}

export async function deleteSource(id: number): Promise<void> {
  await apiRequest<void>("DELETE", `/sermon-sources/${id}`);
}

/** The YouTube page for a ledger row. songbird stores the id and never the link, so exactly one
 * place builds it. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * A video's length in words: "18 min", "1 hr 24 min", or "length unknown".
 *
 * Null is genuinely unknown, not zero. A video YouTube gave no duration for was never filtered on
 * length at all, and showing "0 min" would claim the opposite of what songbird decided.
 */
export function formatVideoLength(seconds: number | null): string {
  if (seconds === null) return "length unknown";
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** Ask songbird to check every enabled source. It answers as soon as the request is written
 * down — the scan itself runs in the background. */
export async function checkAllSources(): Promise<SermonCheckQueued> {
  const data = await apiRequest<unknown>("POST", "/sermon-sources/check");
  return sermonCheckQueuedSchema.parse(data);
}

/** Ask songbird to check one source now. */
export async function checkSource(id: number): Promise<SermonCheckQueued> {
  const data = await apiRequest<unknown>("POST", `/sermon-sources/${id}/check`);
  return sermonCheckQueuedSchema.parse(data);
}

/**
 * Which rows a reader is looking at (spec §8).
 *
 * The same five things narrow the list and drive the bulk dismiss, which is why they are one type:
 * "dismiss all N matching" means the filter on screen, and the two must be sent identically or the
 * sweep would take rows nobody saw. `publishedBefore` / `publishedAfter` are `YYYY-MM-DD`, both
 * ends inclusive, and the server compares them against the day the row SHOWS.
 */
export interface SermonVideoFilters {
  status?: SermonVideoStatus;
  sourceId?: number;
  publishedAfter?: string;
  publishedBefore?: string;
  q?: string;
}

/** The filter as query parameters. One function, so the listing and the sweep cannot drift. */
function filterParams(filters: SermonVideoFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceId !== undefined) params.set("source_id", String(filters.sourceId));
  if (filters.publishedAfter) params.set("published_after", filters.publishedAfter);
  if (filters.publishedBefore) params.set("published_before", filters.publishedBefore);
  if (filters.q) params.set("q", filters.q);
  return params;
}

/** The filter as a request body — the shape the bulk dismiss takes. */
function filterBody(filters: SermonVideoFilters): Record<string, string | number> {
  return Object.fromEntries(filterParams(filters));
}

/** One page of the ledger — everything a check has seen, newest sermon first. An absent filter
 * means "every state" / "every source". */
export async function listSourceVideos(
  filters: SermonVideoFilters = {},
  page: { limit?: number; offset?: number } = {},
): Promise<SermonSourceVideosPage> {
  const params = filterParams(filters);
  params.set("limit", String(page.limit ?? 50));
  params.set("offset", String(page.offset ?? 0));
  const data = await apiRequest<unknown>("GET", `/sermon-sources/videos?${params.toString()}`);
  return sermonSourceVideosPageSchema.parse(data);
}

/** Write the sermon notes for a video — one per reference, all of them or none. */
export async function placeVideo(
  id: number,
  references: string[],
): Promise<SermonSourceVideo> {
  const data = await apiRequest<unknown>("POST", `/sermon-sources/videos/${id}/place`, {
    references,
  });
  return sermonSourceVideoSchema.parse(data);
}

/** Not a sermon, its undo, and the fix for a wrong passage. Each answers with the row's new shape,
 * so the list redraws one row instead of refetching hundreds. */
export async function dismissVideo(id: number): Promise<SermonSourceVideo> {
  return sermonSourceVideoSchema.parse(
    await apiRequest<unknown>("POST", `/sermon-sources/videos/${id}/dismiss`),
  );
}

export async function restoreVideo(id: number): Promise<SermonSourceVideo> {
  return sermonSourceVideoSchema.parse(
    await apiRequest<unknown>("POST", `/sermon-sources/videos/${id}/restore`),
  );
}

export async function reopenVideo(id: number): Promise<SermonSourceVideo> {
  return sermonSourceVideoSchema.parse(
    await apiRequest<unknown>("POST", `/sermon-sources/videos/${id}/reopen`),
  );
}

/** Mark everything the filter selects as not a sermon. The server refuses an empty filter. */
export async function dismissMatching(filters: SermonVideoFilters): Promise<number> {
  const data = await apiRequest<unknown>(
    "POST",
    "/sermon-sources/videos/dismiss-matching",
    filterBody(filters),
  );
  return sermonVideosDismissedSchema.parse(data).dismissed;
}

/**
 * The day a sermon happened, as the church's own page shows it (spec §7).
 *
 * A livestreamed service is dated by when the stream STARTED, not when the video went up: those
 * two genuinely differ, and usually by a day — a service streamed at 14:55 UTC on the Sunday is
 * routinely published at 04:32 on the Monday. Dating it by the publish time would put a Sunday
 * sermon under Monday and disagree with the "Streamed live on…" line a reader can see on YouTube.
 */
export function sermonDay(video: {
  actual_start_time: string | null;
  published_at: string;
}): string {
  return (video.actual_start_time ?? video.published_at).slice(0, 10);
}
