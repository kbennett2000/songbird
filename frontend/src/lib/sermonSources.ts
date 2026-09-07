import { apiRequest } from "@/lib/api";
import {
  type SermonCheckQueued,
  type SermonSource,
  type SermonSourceVideosPage,
  type SermonSourcesStatus,
  type SermonVideoStatus,
  sermonCheckQueuedSchema,
  sermonSourceSchema,
  sermonSourceVideosPageSchema,
  sermonSourcesListSchema,
  sermonSourcesStatusSchema,
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

export interface SermonVideoFilters {
  status?: SermonVideoStatus;
  sourceId?: number;
  limit?: number;
  offset?: number;
}

/** One page of the ledger — everything a check has seen, newest sermon first. An absent filter
 * means "every state" / "every source". */
export async function listSourceVideos(
  filters: SermonVideoFilters = {},
): Promise<SermonSourceVideosPage> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceId !== undefined) params.set("source_id", String(filters.sourceId));
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  const data = await apiRequest<unknown>("GET", `/sermon-sources/videos?${params.toString()}`);
  return sermonSourceVideosPageSchema.parse(data);
}
