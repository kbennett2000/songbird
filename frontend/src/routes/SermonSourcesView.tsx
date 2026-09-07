import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { RedateSermonsModal } from "@/components/RedateSermonsModal";
import { SermonSourceForm, type SermonSourceFormValues } from "@/components/SermonSourceForm";
import { SermonVideoLedger } from "@/components/SermonVideoLedger";
import { TopNav } from "@/components/TopNav";
import { ApiError } from "@/lib/api";
import { formatEventDate } from "@/lib/notes";
import { fetchTags } from "@/lib/reader";
import { applyRedate, previewRedate } from "@/lib/redate";
import {
  checkAllSources,
  checkSource,
  createSource,
  deleteSource,
  fetchSourcesStatus,
  listSources,
  updateSource,
} from "@/lib/sermonSources";
import type { RedateResult, SermonSource, SermonSourceCounts } from "@/schemas";

/** How often the page asks whether the check is still going, while one is. Short enough that
 * finishing feels immediate, long enough that a back-catalogue scan isn't answering the door
 * twenty times a minute. */
const SCAN_POLL_MS = 3000;

/** The tag chips every list in songbird uses. */
function TagChips({ tags }: { tags: string[] }): JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-xs text-blue-800 dark:text-blue-300"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

/** The source's facts in one plain line: what it is, and how it's filtered. */
function SourceFacts({
  source,
  minMinutesDefault,
}: {
  source: SermonSource;
  minMinutesDefault: number;
}): JSX.Element {
  const parts = [
    source.kind === "channel" ? "Channel" : "Playlist",
    source.include_live ? "includes livestreams" : "no livestreams",
    source.min_minutes === null
      ? `${minMinutesDefault} minutes or longer`
      : `${source.min_minutes} minutes or longer`,
    source.check_requested_at !== null
      ? "waiting to be checked"
      : source.last_checked_at === null
        ? "never checked"
        : // Sliced to the calendar day and parsed part by part rather than through `new Date()`:
          // these timestamps arrive without a timezone, so the browser would read them as local
          // and show the day before to anyone west of UTC.
          `checked ${formatEventDate(source.last_checked_at.slice(0, 10))}`,
  ];
  return (
    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
      {parts.join(" · ")}
      {!source.enabled && (
        <span className="ml-2 rounded bg-amber-100 dark:bg-amber-900 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
          Paused
        </span>
      )}
    </p>
  );
}

/** The states a count can be in, in the order a reader meets them, in the reader's words. */
const COUNT_LABELS: [keyof SermonSourceCounts, string][] = [
  ["pending", "waiting"],
  ["needs_passage", "needs a passage"],
  ["placed", "placed"],
  ["skipped", "skipped"],
  ["already_noted", "already noted"],
];

/** What a source's checks have found so far — only the numbers that aren't zero, so a source that
 * has only ever skipped things doesn't show four noughts to say so. */
function SourceCounts({ counts }: { counts: SermonSourceCounts }): JSX.Element | null {
  const shown = COUNT_LABELS.filter(([key]) => counts[key] > 0);
  if (shown.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
      {shown.map(([key, label]) => (
        <span key={key}>
          <span className="font-semibold">{counts[key]}</span> {label}
        </span>
      ))}
    </p>
  );
}

/**
 * The Sermon sources page (v1.7, spec §10): the channels and playlists songbird collects sermons
 * from, and the home of the re-date action (spec §11 — it lived on Browse only until this page
 * existed).
 *
 * Without a YouTube API key the page is one sentence and nothing else: no list, no add form, no
 * controls that would fail if pressed.
 */
export function SermonSourcesView(): JSX.Element {
  const queryClient = useQueryClient();
  // Inline result of the last action — the app has no toast; this is its banner (as on Browse).
  const [actionMsg, setActionMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  // The row whose Delete has been pressed once. Two steps, in place, so you can still see which
  // source you are about to forget.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // The re-date preview, once the server has produced one. Non-null IS the dialog being open.
  const [redatePreview, setRedatePreview] = useState<RedateResult | null>(null);

  const statusQuery = useQuery({
    queryKey: ["sermon-sources-status"],
    queryFn: fetchSourcesStatus,
    // songbird's only polling query, and it polls only while there is something to watch, so the
    // page costs nothing at rest. Returning false is what stops the timer, so the moment the
    // server says the check is done the page goes quiet again.
    //
    // The `error === null` guard is not decoration: a query keeps its last successful data
    // through a failure, so without it a songbird that had gone away would be asked every three
    // seconds for as long as the tab stayed open.
    refetchInterval: (query) =>
      query.state.error === null && query.state.data?.scan_running ? SCAN_POLL_MS : false,
  });
  const configured = statusQuery.data?.configured ?? false;
  const scanning = statusQuery.data?.scan_running ?? false;
  const minMinutesDefault = statusQuery.data?.min_minutes_default ?? 10;

  // Both wait for the status: with no key there is nothing to list and asking would only fail.
  const sourcesQuery = useQuery({
    queryKey: ["sermon-sources"],
    queryFn: listSources,
    enabled: configured,
  });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: fetchTags, enabled: configured });

  const fail = (err: unknown, fallback: string) => {
    const code = err instanceof ApiError ? err.code : "";
    setActionMsg({
      kind: "error",
      text:
        code === "YOUTUBE_NOT_CONFIGURED"
          ? "songbird needs a YouTube API key for this — set YOUTUBE_API_KEY in its configuration and restart."
          : err instanceof Error
            ? err.message
            : fallback,
    });
  };

  // A source's tags feed the shared vocabulary, so the tag list is stale after any write.
  const refreshSources = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sermon-sources"] }),
      queryClient.invalidateQueries({ queryKey: ["tags"] }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: createSource,
    onSuccess: async (source) => {
      setAdding(false);
      await refreshSources();
      setActionMsg({ kind: "ok", text: `Added ${source.title}.` });
    },
    onError: (err) => fail(err, "Couldn't add that source."),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: SermonSourceFormValues }) =>
      updateSource(id, {
        tags: values.tags,
        enabled: values.enabled,
        include_live: values.include_live,
        min_minutes: values.min_minutes,
      }),
    onSuccess: async (source) => {
      setEditingId(null);
      await refreshSources();
      setActionMsg({ kind: "ok", text: `Saved ${source.title}.` });
    },
    onError: (err) => fail(err, "Couldn't save that source."),
  });

  // A check FINISHING is a transition, not a state — no single answer from the server says "just
  // finished" — so the page remembers what the last one said and acts on the change. The counts,
  // the last-checked line and the ledger are all stale the instant a scan stops, and nothing else
  // would tell them.
  const wasScanning = useRef(false);
  useEffect(() => {
    if (wasScanning.current && !scanning) {
      void queryClient.invalidateQueries({ queryKey: ["sermon-sources"] });
      void queryClient.invalidateQueries({ queryKey: ["sermon-source-videos"] });
      setActionMsg({ kind: "ok", text: "Finished checking. Each source shows how it went." });
    }
    wasScanning.current = scanning;
  }, [scanning, queryClient]);

  // "Check now" doesn't wait for the check: the server writes the request down, wakes the runner
  // and answers straight away. Everything after that is the poll's job.
  const checkMutation = useMutation({
    mutationFn: (source: SermonSource | null) =>
      source === null ? checkAllSources() : checkSource(source.id),
    onSuccess: async (result) => {
      // Refetching the status is what STARTS the poll — until the page has seen `scan_running`
      // true there is no timer. The server sets that flag before it answers, so one refetch is
      // enough. The sources refetch is for `check_requested_at`, which is how a row says it is
      // waiting its turn.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sermon-sources-status"] }),
        queryClient.invalidateQueries({ queryKey: ["sermon-sources"] }),
      ]);
      // Nothing in the banner when work was queued: the indicator below is the live region for
      // scan state, and saying it in both places puts the same sentence on screen twice.
      if (result.queued === 0) {
        setActionMsg({ kind: "ok", text: "Nothing to check — every source is paused." });
      }
    },
    onError: (err) => fail(err, "Couldn't start a check."),
  });

  const removeMutation = useMutation({
    mutationFn: (source: SermonSource) => deleteSource(source.id),
    onSuccess: async (_result, source) => {
      setConfirmingId(null);
      await refreshSources();
      setActionMsg({ kind: "ok", text: `Removed ${source.title}. Your sermon notes are safe.` });
    },
    onError: (err) => {
      setConfirmingId(null);
      fail(err, "Couldn't remove that source.");
    },
  });

  // Re-dating (spec §11): a dry run first, always. Both requests live here so the whole action's
  // data flow is in one place and the dialog stays presentational.
  const previewMutation = useMutation({
    mutationFn: previewRedate,
    onSuccess: (preview) => setRedatePreview(preview),
    onError: (err) => fail(err, "Couldn't check your sermon notes against YouTube."),
  });

  const applyMutation = useMutation({
    mutationFn: applyRedate,
    onSuccess: async (result) => {
      setRedatePreview(null);
      // Both the Browse list and the Welcome page read ["browse-sermon"]; the reader's chapter
      // overlay carries event_date too, so its cache is stale as well.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["browse-sermon"] }),
        queryClient.invalidateQueries({ queryKey: ["chapter"] }),
      ]);
      setActionMsg({
        kind: "ok",
        text:
          result.applied === 0
            ? "Nothing to change — every date already matches YouTube."
            : `Re-dated ${result.applied} sermon note${result.applied === 1 ? "" : "s"}.`,
      });
    },
    onError: (err) => {
      setRedatePreview(null);
      fail(err, "Couldn't re-date your sermon notes.");
    },
  });

  const sources = sourcesQuery.data ?? [];

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav
        actions={
          configured ? (
            <button
              type="button"
              className="text-blue-700 dark:text-blue-400 hover:underline disabled:opacity-50"
              onClick={() => {
                setActionMsg(null);
                previewMutation.mutate();
              }}
              disabled={previewMutation.isPending}
            >
              {previewMutation.isPending ? "Checking…" : "Re-date YouTube sermons"}
            </button>
          ) : undefined
        }
      />

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-3 text-2xl font-bold tracking-tight">Sermon sources</h1>

        {actionMsg && (
          <p
            className={`mb-4 text-sm ${
              actionMsg.kind === "ok"
                ? // A dark variant it was missing: emerald-700 on the dark page is 3.24:1, under
                  // the 4.5:1 a reader needs. Same class of mistake as #122, found the same way.
                  "text-emerald-700 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
            role="status"
          >
            {actionMsg.text}
          </p>
        )}

        {statusQuery.isPending && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}

        {statusQuery.data && !configured && (
          <p className="text-gray-700 dark:text-gray-200">
            songbird needs a free YouTube API key before it can find your sermons. Put it in the{" "}
            <code className="rounded bg-gray-100 dark:bg-gray-800 px-1">.env</code> file next to{" "}
            <code className="rounded bg-gray-100 dark:bg-gray-800 px-1">docker-compose.yml</code> on
            a line reading{" "}
            <code className="rounded bg-gray-100 dark:bg-gray-800 px-1">
              YOUTUBE_API_KEY=your-key-here
            </code>
            , then restart songbird.
          </p>
        )}

        {configured && (
          <>
            <section aria-label="Add a source" className="mb-6">
              {adding ? (
                <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Add a source
                  </h2>
                  <SermonSourceForm
                    mode="add"
                    initial={{
                      url: "",
                      tags: [],
                      enabled: true,
                      include_live: true,
                      min_minutes: null,
                    }}
                    suggestions={tagsQuery.data ?? []}
                    minMinutesDefault={minMinutesDefault}
                    saving={addMutation.isPending}
                    onSave={(values) => {
                      setActionMsg(null);
                      addMutation.mutate({
                        url: values.url,
                        tags: values.tags,
                        include_live: values.include_live,
                        min_minutes: values.min_minutes,
                      });
                    }}
                    onCancel={() => setAdding(false)}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
                    onClick={() => {
                      setActionMsg(null);
                      setAdding(true);
                    }}
                  >
                    Add source
                  </button>
                  {/* In the body rather than the nav's actions slot: that row already wraps eight
                      links plus the user and theme controls at phone width, and a third action is
                      where it breaks. */}
                  <button
                    type="button"
                    className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    onClick={() => {
                      setActionMsg(null);
                      checkMutation.mutate(null);
                    }}
                    disabled={scanning || checkMutation.isPending}
                  >
                    Check all now
                  </button>
                  {scanning && (
                    // The live region for scan state, and the only place it is said: a check
                    // starting is news, and it belongs beside the control that caused it. The
                    // banner stays quiet for a queued check so the same sentence does not appear
                    // twice on screen.
                    //
                    // Status, not a dimmed control — its own text in its own colour, never an
                    // opacity on something else.
                    <span role="status" className="text-sm text-gray-600 dark:text-gray-300">
                      Checking your sources…
                    </span>
                  )}
                </div>
              )}
            </section>

            <section aria-label="Sources">
              {sourcesQuery.isPending && (
                <p className="text-gray-500 dark:text-gray-400">Loading…</p>
              )}
              {sourcesQuery.data && sources.length === 0 && (
                <p className="text-gray-500 dark:text-gray-400">
                  No sources yet. Add the church whose sermons you take notes on, and songbird will
                  know where to look.
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {sources.map((source) => (
                  <li
                    key={source.id}
                    className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-semibold">{source.title}</span>
                      <a
                        href={source.input_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
                      >
                        View on YouTube
                      </a>
                    </div>
                    <SourceFacts source={source} minMinutesDefault={minMinutesDefault} />
                    {source.last_check_status !== null && source.last_check_status !== "ok" && (
                      // Its own line, not squeezed into the ·-joined facts: a plain-English
                      // failure reason is a sentence, and it needs room to read as one.
                      <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                        Last check: {source.last_check_status}
                      </p>
                    )}
                    <SourceCounts counts={source.counts} />
                    <TagChips tags={source.tags} />

                    {editingId === source.id ? (
                      <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                        <SermonSourceForm
                          mode="edit"
                          initial={{
                            url: source.input_url,
                            tags: source.tags,
                            enabled: source.enabled,
                            include_live: source.include_live,
                            min_minutes: source.min_minutes,
                          }}
                          suggestions={tagsQuery.data ?? []}
                          minMinutesDefault={minMinutesDefault}
                          saving={editMutation.isPending}
                          onSave={(values) => {
                            setActionMsg(null);
                            editMutation.mutate({ id: source.id, values });
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      </div>
                    ) : confirmingId === source.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="text-sm text-gray-700 dark:text-gray-200">
                          Remove {source.title}? Your sermon notes stay.
                        </span>
                        <button
                          type="button"
                          className="rounded bg-red-700 px-3 py-1 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                          onClick={() => {
                            setActionMsg(null);
                            removeMutation.mutate(source);
                          }}
                          disabled={removeMutation.isPending}
                        >
                          {removeMutation.isPending ? "Removing…" : "Remove"}
                        </button>
                        <button
                          type="button"
                          className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {/* Absent on a paused source rather than disabled: the runner only ever
                            picks up enabled sources, so the button would have nothing to do. */}
                        {source.enabled && (
                          <button
                            type="button"
                            className="text-sm text-blue-700 dark:text-blue-400 hover:underline disabled:opacity-50"
                            onClick={() => {
                              setActionMsg(null);
                              checkMutation.mutate(source);
                            }}
                            disabled={
                              scanning ||
                              checkMutation.isPending ||
                              source.check_requested_at !== null
                            }
                          >
                            Check now
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
                          onClick={() => {
                            setActionMsg(null);
                            setConfirmingId(null);
                            setEditingId(source.id);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-600 dark:text-red-400 hover:underline"
                          onClick={() => {
                            setActionMsg(null);
                            setEditingId(null);
                            setConfirmingId(source.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {sources.length > 0 && <SermonVideoLedger sources={sources} />}
          </>
        )}
      </main>

      <RedateSermonsModal
        preview={redatePreview}
        applying={applyMutation.isPending}
        onApply={() => applyMutation.mutate()}
        onClose={() => setRedatePreview(null)}
      />
    </div>
  );
}
