import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/lib/api";
import { formatEventDate } from "@/lib/notes";
import {
  dismissVideo,
  formatVideoLength,
  placeVideo,
  reopenVideo,
  restoreVideo,
  sermonDay,
  watchUrl,
} from "@/lib/sermonSources";
import type { SermonSourceVideo } from "@/schemas";

/** Every state a row can be in, in the reader's words. Shown on the row as well as offered in
 * the filter, because "Any state" is a mixed list and a row with no controls — one already noted,
 * or one still waiting to be read — would otherwise say nothing about why. */
const STATE_LABEL: Record<SermonSourceVideo["status"], string> = {
  pending: "Waiting",
  needs_passage: "Needs a passage",
  placed: "Placed",
  skipped: "Skipped",
  dismissed: "Not a sermon",
  already_noted: "Already noted",
};

/** Why a video was skipped, in words rather than field names. */
const SKIP_REASON: Record<"too_short" | "live_excluded", string> = {
  too_short: "shorter than this source's minimum",
  live_excluded: "a livestream, and this source leaves those out",
};

/** Where songbird read the passage, so a placement can be traced to the rule that made it. */
const PLACED_BY: Record<"scripture_line" | "title" | "first_line" | "manual", string> = {
  scripture_line: "from the scripture line in the description",
  title: "from the title",
  first_line: "from the first line of the description",
  manual: "because you chose it",
};

const ACTION = "text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline disabled:opacity-50";
const QUIET = "text-sm font-medium text-gray-600 dark:text-gray-300 hover:underline disabled:opacity-50";
const PRIMARY =
  "rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50";

/**
 * A reference the reader chose, either by tapping a chip or by typing one.
 *
 * The server is the only judge of whether it means anything — nothing here parses a reference, the
 * same rule the sermon-note form follows (invariant 4). All this decides is whether there is
 * something to send.
 */
function chosen(selected: string[], typed: string): string[] {
  const extra = typed.trim();
  return extra === "" || selected.includes(extra) ? selected : [...selected, extra];
}

/** The message a failed place shows. The server names the reference it could not find, and that
 * is more use than anything generic — so it is preferred whenever there is one. */
function placeError(err: unknown): string {
  if (err instanceof ApiError && err.code === "NOT_FOUND" && err.message) return err.message;
  if (err instanceof ApiError && err.code === "VIDEO_STATE") return err.message;
  return "Couldn't save that — check the spelling (e.g. Joshua 6:1-16), or is Concord reachable?";
}

export function SermonVideoRow({
  video,
  onChanged,
}: {
  video: SermonSourceVideo;
  onChanged: (updated: SermonSourceVideo, previous: SermonSourceVideo["status"]) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Non-null IS the confirm being open, the same shape the Sources page uses for delete.
  const [confirming, setConfirming] = useState(false);
  // A skipped video only grows the place controls once you say it was a sermon after all.
  const [noteAnyway, setNoteAnyway] = useState(false);

  /** Every action clears the row's working state and hands the new row up to the list. */
  const settled = (updated: SermonSourceVideo) => {
    setError(null);
    setSelected([]);
    setTyped("");
    setConfirming(false);
    setNoteAnyway(false);
    onChanged(updated, video.status);
  };
  const failed = (err: unknown) => setError(placeError(err));

  const references = chosen(selected, typed);
  const place = useMutation({
    mutationFn: () => placeVideo(video.id, references),
    onSuccess: settled,
    onError: failed,
  });
  const dismiss = useMutation({
    mutationFn: () => dismissVideo(video.id),
    onSuccess: settled,
    onError: failed,
  });
  const restore = useMutation({
    mutationFn: () => restoreVideo(video.id),
    onSuccess: settled,
    onError: failed,
  });
  const reopen = useMutation({
    mutationFn: () => reopenVideo(video.id),
    onSuccess: settled,
    onError: failed,
  });
  const busy = place.isPending || dismiss.isPending || restore.isPending || reopen.isPending;

  const placing = video.status === "needs_passage" || noteAnyway;

  return (
    <li className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      {/* `break-words`: a YouTube title can run a hundred characters with nowhere to wrap. */}
      <p className="break-words font-medium text-gray-900 dark:text-gray-100">{video.title}</p>

      {/* Each fact is its own span so a phone has somewhere to break the line, and the separators
          are aria-hidden so a screen reader doesn't read "middle dot" four times a row. */}
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-gray-500 dark:text-gray-400">
        {/* The day the sermon happened, which for a stream is when it STARTED — that is what the
            church's own page says, and what `published_at` alone gets wrong by a day. */}
        <span>{formatEventDate(sermonDay(video))}</span>
        <span aria-hidden="true">·</span>
        <span>{formatVideoLength(video.duration_seconds)}</span>
        <span aria-hidden="true">·</span>
        <span className="text-gray-700 dark:text-gray-200">{STATE_LABEL[video.status]}</span>
        {video.status === "skipped" && video.skip_reason !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{SKIP_REASON[video.skip_reason]}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <a
          href={watchUrl(video.video_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
        >
          Watch
        </a>
      </p>

      <p className="mt-0.5 break-words text-sm text-gray-500 dark:text-gray-400">
        {video.source_title}
      </p>

      {/* What songbird made of it. A placed row names the passages it wrote a note on and the rule
          that read them, so a wrong placement can be traced to the rule that made it — and each
          one opens in the reader, which is where you go to see whether it was right. */}
      {video.notes.length > 0 && (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-gray-700 dark:text-gray-200">
          <span className="text-gray-500 dark:text-gray-400">Noted on</span>
          {video.notes.map((note) => (
            <Link
              key={note.id}
              to={`/read?book=${note.book_usfm}&chapter=${note.start_chapter}`}
              className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
            >
              {note.reference}
            </Link>
          ))}
          {video.placed_by !== null && (
            <span className="text-gray-500 dark:text-gray-400">{PLACED_BY[video.placed_by]}</span>
          )}
        </p>
      )}

      {placing && (
        <div className="mt-2">
          {video.suggestions.length > 0 && (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                songbird couldn&rsquo;t tell which of these the sermon was on:
              </p>
              {/* One note each, so several can be on at once. `py-2` rather than the `py-0.5` these
                  were as plain text: this is a tap target on a phone now. */}
              <ul aria-label="Possible passages" className="mt-1 flex flex-wrap gap-2">
                {video.suggestions.map((reference) => {
                  const on = selected.includes(reference);
                  return (
                    <li key={reference}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setSelected((was) =>
                            was.includes(reference)
                              ? was.filter((r) => r !== reference)
                              : [...was, reference],
                          )
                        }
                        className={`rounded-full px-3 py-2 text-sm ${
                          on
                            ? "bg-blue-700 text-white"
                            : "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                        }`}
                      >
                        {reference}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <label className="mt-2 block text-sm text-gray-500 dark:text-gray-400">
            {video.suggestions.length > 0 ? "Or type one" : "Which passage was it?"}
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="e.g. John 3:16 or Joshua 6:1-16"
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
          </label>
        </div>
      )}

      {error !== null && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* `flex-wrap`: at phone width these stack rather than run off the edge of the card. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {placing && (
          <button
            type="button"
            onClick={() => place.mutate()}
            disabled={busy || references.length === 0}
            className={PRIMARY}
          >
            {place.isPending ? "Placing…" : "Place"}
          </button>
        )}
        {(video.status === "needs_passage" || video.status === "skipped") && (
          <button
            type="button"
            onClick={() => dismiss.mutate()}
            disabled={busy}
            className={QUIET}
          >
            {dismiss.isPending ? "Saving…" : "Not a sermon"}
          </button>
        )}
        {video.status === "skipped" && !noteAnyway && (
          <button type="button" onClick={() => setNoteAnyway(true)} className={ACTION}>
            Note it anyway
          </button>
        )}
        {video.status === "dismissed" && (
          <button
            type="button"
            onClick={() => restore.mutate()}
            disabled={busy}
            className={ACTION}
          >
            {restore.isPending ? "Restoring…" : "Restore"}
          </button>
        )}
        {video.status === "placed" &&
          (confirming ? (
            // Two steps, in place, so you can still see which video you are about to un-note.
            <>
              <span className="text-sm text-gray-700 dark:text-gray-200">
                Take back {video.notes.length === 1 ? "this note" : `these ${video.notes.length} notes`}{" "}
                and put it back in the list?
              </span>
              <button
                type="button"
                onClick={() => reopen.mutate()}
                disabled={busy}
                className="rounded bg-red-700 px-3 py-1 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {reopen.isPending ? "Removing…" : "Remove"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={QUIET}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={QUIET}>
              Wrong passage
            </button>
          ))}
      </div>
    </li>
  );
}
