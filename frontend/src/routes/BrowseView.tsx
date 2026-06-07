import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { downloadExport, importNotes, readJsonFile } from "@/lib/importExport";
import { type NoteAnchor, noteReference, notePreview, readerLink } from "@/lib/notes";
import { browseAnnotations, browseSermonNotes, fetchBooks, fetchTags } from "@/lib/reader";

function TagChips({ tags }: { tags: string[] }): JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
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
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 p-4">
          <h1 className="text-2xl font-bold tracking-tight">Browse notes</h1>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <button
              type="button"
              className="text-blue-700 hover:underline"
              onClick={onExport}
            >
              Export
            </button>
            <button
              type="button"
              className="text-blue-700 hover:underline disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? "Importing…" : "Import"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import notes file"
              onChange={onFilePicked}
            />
            <Link to="/read" className="text-blue-700 hover:underline">
              Reader
            </Link>
            <Link to="/" className="text-blue-700 hover:underline">
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {actionMsg && (
          <p
            className={`mb-4 text-sm ${
              actionMsg.kind === "ok" ? "text-emerald-700" : "text-red-600"
            }`}
            role="status"
          >
            {actionMsg.text}
          </p>
        )}
        <section aria-label="Tag filter" className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Filter by tag (all selected)</h2>
          <div className="flex flex-wrap gap-2">
            {(tagsQuery.data ?? []).length === 0 && (
              <span className="text-sm text-gray-400">No tags yet.</span>
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
                      : "border border-gray-300 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Notes" className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Notes</h2>
          {annotationsQuery.isPending && <p className="text-gray-500">Loading…</p>}
          {annotationsQuery.data && annotationsQuery.data.length === 0 && (
            <p className="text-gray-500">No notes match.</p>
          )}
          <ul className="flex flex-col gap-3">
            {annotationsQuery.data?.map((a) => (
              <li key={a.id} className="rounded border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{noteReference(a, booksById)}</span>
                  <Link to={linkTo(a)} className="ml-auto text-sm text-blue-700 hover:underline">
                    Open in reader
                  </Link>
                </div>
                <p className="mt-1 text-sm text-gray-600">{notePreview(a.note_markdown)}</p>
                <TagChips tags={a.tags} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Sermon notes">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Sermon notes
          </h2>
          {sermonNotesQuery.isPending && <p className="text-gray-500">Loading…</p>}
          {sermonNotesQuery.data && sermonNotesQuery.data.length === 0 && (
            <p className="text-gray-500">No sermon notes match.</p>
          )}
          <ul className="flex flex-col gap-3">
            {sermonNotesQuery.data?.map((n) => (
              <li key={n.id} className="rounded border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Sermon
                  </span>
                  <span className="font-semibold">{noteReference(n, booksById)}</span>
                  <Link to={linkTo(n)} className="ml-auto text-sm text-blue-700 hover:underline">
                    Open in reader
                  </Link>
                </div>
                <p className="mt-1 text-sm text-gray-700">{n.title}</p>
                <TagChips tags={n.tags} />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
