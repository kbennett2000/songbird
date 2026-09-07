import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { RedateSermonsModal } from "@/components/RedateSermonsModal";
import {
  SermonSourceForm,
  type SermonSourceFormValues,
} from "@/components/SermonSourceForm";
import { TopNav } from "@/components/TopNav";
import { ApiError } from "@/lib/api";
import { fetchTags } from "@/lib/reader";
import { applyRedate, previewRedate } from "@/lib/redate";
import {
  createSource,
  deleteSource,
  fetchSourcesStatus,
  listSources,
  updateSource,
} from "@/lib/sermonSources";
import type { RedateResult, SermonSource } from "@/schemas";

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
    // Nothing has scanned yet — slice 4 fills this in.
    source.last_checked_at === null ? "never checked" : `checked ${source.last_checked_at}`,
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
  });
  const configured = statusQuery.data?.configured ?? false;
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
              actionMsg.kind === "ok" ? "text-emerald-700" : "text-red-600 dark:text-red-400"
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
            <code className="rounded bg-gray-100 dark:bg-gray-800 px-1">docker-compose.yml</code>{" "}
            on a line reading{" "}
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
              )}
            </section>

            <section aria-label="Sources">
              {sourcesQuery.isPending && (
                <p className="text-gray-500 dark:text-gray-400">Loading…</p>
              )}
              {sourcesQuery.data && sources.length === 0 && (
                <p className="text-gray-500 dark:text-gray-400">
                  No sources yet. Add the church whose sermons you take notes on, and songbird
                  will know where to look.
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
                      <div className="mt-3 flex gap-3">
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
