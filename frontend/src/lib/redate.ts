import { apiRequest } from "@/lib/api";
import { type RedateResult, redateResultSchema } from "@/schemas";

/**
 * Re-dating YouTube sermon notes (v1.7 sermon sources).
 *
 * songbird's sermon dates should be the day the sermon was preached, which YouTube knows and a
 * hand-typed note usually doesn't. The server looks each note's video up and works the date out;
 * these two calls are the preview and the commit.
 */

/** What the re-date WOULD do. Writes nothing — this is the gate before {@link applyRedate}. */
export async function previewRedate(): Promise<RedateResult> {
  // `dry_run=true` is sent explicitly even though it is the server's default: the safe direction
  // should be visible at the call site, not inferred from a default that could change.
  const data = await apiRequest<unknown>("POST", "/sermon-notes/redate?dry_run=true");
  return redateResultSchema.parse(data);
}

/** Write the new dates. Re-runnable — a second call changes nothing and reports zero applied. */
export async function applyRedate(): Promise<RedateResult> {
  const data = await apiRequest<unknown>("POST", "/sermon-notes/redate?dry_run=false");
  return redateResultSchema.parse(data);
}
