import { apiRequest } from "@/lib/api";
import {
  type SermonSource,
  type SermonSourcesStatus,
  sermonSourceSchema,
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
