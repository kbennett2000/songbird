import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { RedateSermonsModal } from "@/components/RedateSermonsModal";
import { TopNav } from "@/components/TopNav";
import { ApiError } from "@/lib/api";
import { downloadExport, importNotes, readJsonFile } from "@/lib/importExport";
import { type NoteAnchor, noteReference, notePreview, readerLink } from "@/lib/notes";
import { browseAnnotations, browseSermonNotes, fetchBooks, fetchTags } from "@/lib/reader";
import { applyRedate, previewRedate } from "@/lib/redate";
import type { RedateResult } from "@/schemas";

function TagChips({ tags }: { tags: string[] }): JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="rounded bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-xs text-blue-800 dark:text-blue-300">
          {tag}
        </span>
      ))}
    </div>
  );
}

export function BrowseView(): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Inline result of the last export/import action (no toast library — matches the app's style).
  const [actionMsg, setActionMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // The re-date preview, once the server has produced one. Non-null IS the dialog being open.
  const [redatePreview, setRedatePreview] = useState<RedateResult | null>(null);

  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const annotationsQuery = useQuery({
    queryKey: ["browse", selected],
    queryFn: () => browseAnnotations(selected, "all"),
  });
  const sermonNotesQuery = useQuery({
    queryKey: ["browse-sermon", selected],
    queryFn: () => browseSermonNotes(selected, "all"),
  });

  const booksById = useMemo(
    () => new Map((booksQuery.data ?? []).map((b) => [b.id, b])),
    [booksQuery.data],
  );

  const toggle = (tag: string) =>
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  // Import merges a previously-exported file in (server skips duplicates), then we refresh the
  // notes + tag caches this screen reads from so the new notes appear without a reload.
  const importMutation = useMutation({
    mutationFn: async (file: File) => importNotes(await readJsonFile(file)),
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["browse"] }),
        queryClient.invalidateQueries({ queryKey: ["browse-sermon"] }),
        queryClient.invalidateQueries({ queryKey: ["tags"] }),
      ]);
      const created = summary.annotations.created + summary.sermon_notes.created;
      const skipped = summary.annotations.skipped + summary.sermon_notes.skipped;
      const failed = summary.annotations.failed + summary.sermon_notes.failed;
      const text =
        `Imported ${created} · skipped ${skipped}` + (failed > 0 ? ` · ${failed} failed` : "");
      setActionMsg({ kind: "ok", text });
    },
    onError: (err) =>
      setActionMsg({ kind: "error", text: err instanceof Error ? err.message : "Import failed" }),
  });

  // Re-dating YouTube sermons (v1.7): a dry run first, always. Both requests live here so the
  // whole action's data flow is in one place and the dialog stays presentational.
  const redateError = (err: unknown, fallback: string) => {
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

  const previewMutation = useMutation({
    mutationFn: previewRedate,
    onSuccess: (preview) => setRedatePreview(preview),
    onError: (err) => redateError(err, "Couldn't check your sermon notes against YouTube."),
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
      redateError(err, "Couldn't re-date your sermon notes.");
    },
  });

  const onExport = () => {
    setActionMsg(null);
    downloadExport().catch((err) =>
      setActionMsg({ kind: "error", text: err instanceof Error ? err.message : "Export failed" }),
    );
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so re-picking the same file fires onChange again
    if (file) {
      setActionMsg(null);
      importMutation.mutate(file);
    }
  };

  const linkTo = (a: NoteAnchor) => readerLink(a);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav
        actions={
          <>
            <button type="button" className="text-blue-700 dark:text-blue-400 hover:underline" onClick={onExport}>
              Export
            </button>
            <button
              type="button"
              className="text-blue-700 dark:text-blue-400 hover:underline disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? "Importing…" : "Import"}
            </button>
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
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import notes file"
              onChange={onFilePicked}
            />
          </>
        }
      />

      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-3 text-2xl font-bold tracking-tight">Browse notes</h1>
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
        <section aria-label="Tag filter" className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">Filter by tag (all selected)</h2>
          <div className="flex flex-wrap gap-2">
            {(tagsQuery.data ?? []).length === 0 && (
              <span className="text-sm text-gray-400 dark:text-gray-500">No tags yet.</span>
            )}
            {(tagsQuery.data ?? []).map((tag) => {
              const on = selected.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    on
                      ? "bg-blue-600 text-white"
                      : "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Notes" className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Notes</h2>
          {annotationsQuery.isPending && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}
          {annotationsQuery.data && annotationsQuery.data.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">No notes match.</p>
          )}
          <ul className="flex flex-col gap-3">
            {annotationsQuery.data?.map((a) => (
              <li key={a.id} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{noteReference(a, booksById)}</span>
                  <Link to={linkTo(a)} className="ml-auto text-sm text-blue-700 dark:text-blue-400 hover:underline">
                    Open in reader
                  </Link>
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{notePreview(a.note_markdown)}</p>
                <TagChips tags={a.tags} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Sermon notes">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Sermon notes
          </h2>
          {sermonNotesQuery.isPending && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}
          {sermonNotesQuery.data && sermonNotesQuery.data.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">No sermon notes match.</p>
          )}
          <ul className="flex flex-col gap-3">
            {sermonNotesQuery.data?.map((n) => (
              <li key={n.id} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Sermon
                  </span>
                  <span className="font-semibold">{noteReference(n, booksById)}</span>
                  <Link to={linkTo(n)} className="ml-auto text-sm text-blue-700 dark:text-blue-400 hover:underline">
                    Open in reader
                  </Link>
                </div>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{n.title}</p>
                <TagChips tags={n.tags} />
              </li>
            ))}
          </ul>
        </section>
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
