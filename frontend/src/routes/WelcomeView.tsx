import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { noteReference, notePreview, readerLink } from "@/lib/notes";
import { browseAnnotations, browseSermonNotes, fetchBooks, fetchTags } from "@/lib/reader";
import type { Annotation, SermonNote } from "@/schemas";

const RECENT_LIMIT = 6;

// One row of the "recent notes" feed — an annotation or a sermon note, unified by canonical anchor
// + an `updated_at` to sort on (both kinds carry these).
type RecentItem =
  | { kind: "note"; item: Annotation; updated_at: string; id: number }
  | { kind: "sermon"; item: SermonNote; updated_at: string; id: number };

const QUICK_LINKS = [
  { to: "/browse", title: "Browse notes", blurb: "Every note, filtered by tag." },
  { to: "/search", title: "Search", blurb: "Find Scripture by meaning + your notes." },
  { to: "/compare", title: "Compare", blurb: "Read translations side by side." },
] as const;

/**
 * The landing page (issue #43). Greets the user, offers a one-tap jump back to where they left off
 * (the reader at /read seeds from the saved position), surfaces their most-recent notes, shows a
 * small library stat line, and links into the other screens. Frontend-only: every piece reuses data
 * that already exists (the saved position on the profile, the browse lists, the tag vocabulary).
 */
export function WelcomeView(): JSX.Element {
  const { user, logout } = useAuth();

  const booksQuery = useQuery({ queryKey: ["books"], queryFn: fetchBooks });
  const annotationsQuery = useQuery({
    queryKey: ["browse", [] as string[]],
    queryFn: () => browseAnnotations([], "all"),
  });
  const sermonNotesQuery = useQuery({
    queryKey: ["browse-sermon", [] as string[]],
    queryFn: () => browseSermonNotes([], "all"),
  });
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: fetchTags });

  const booksById = useMemo(
    () => new Map((booksQuery.data ?? []).map((b) => [b.id, b])),
    [booksQuery.data],
  );

  const annotations = annotationsQuery.data ?? [];
  const sermonNotes = sermonNotesQuery.data ?? [];
  const notesLoaded = annotationsQuery.isSuccess && sermonNotesQuery.isSuccess;

  // Most-recently touched notes first (tie-break by id so the order is stable), top few. Depends
  // on the query data directly (not the `?? []` consts, whose identity changes each render).
  const recent = useMemo<RecentItem[]>(() => {
    const merged: RecentItem[] = [
      ...(annotationsQuery.data ?? []).map((a) => ({
        kind: "note" as const,
        item: a,
        updated_at: a.updated_at,
        id: a.id,
      })),
      ...(sermonNotesQuery.data ?? []).map((n) => ({
        kind: "sermon" as const,
        item: n,
        updated_at: n.updated_at,
        id: n.id,
      })),
    ];
    merged.sort((x, y) =>
      x.updated_at === y.updated_at ? y.id - x.id : x.updated_at < y.updated_at ? 1 : -1,
    );
    return merged.slice(0, RECENT_LIMIT);
  }, [annotationsQuery.data, sermonNotesQuery.data]);

  // "Continue reading" target — the reader auto-seeds from the saved position, so a bare /read is
  // enough; the label just makes the saved spot legible.
  const lastBookName = user?.last_book
    ? (booksById.get(user.last_book)?.name ?? user.last_book)
    : null;
  const continueLabel =
    lastBookName && user?.last_chapter
      ? `Continue in ${lastBookName} ${user.last_chapter}` +
        (user.last_translation ? ` · ${user.last_translation}` : "")
      : "Start reading";

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 p-4">
          <h1 className="text-2xl font-bold tracking-tight">songbird</h1>
          {user && (
            <span className="ml-auto flex items-center gap-2 text-sm text-gray-500">
              <span title={user.is_admin ? "Admin" : undefined}>{user.username}</span>
              <button
                type="button"
                className="text-blue-700 hover:underline"
                onClick={() => void logout()}
              >
                Log out
              </button>
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
        <section>
          <h2 className="text-3xl font-bold tracking-tight">
            Welcome{user?.username ? `, ${user.username}` : ""}
          </h2>
          <p className="mt-1 text-gray-600">
            Annotate Scripture — read a translation, highlight a verse, find it later.
          </p>
        </section>

        <Link
          to="/read"
          className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-400 hover:shadow"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Pick up where you left off
          </span>
          <div className="mt-1 text-xl font-semibold text-blue-700">{continueLabel} →</div>
        </Link>

        <section aria-label="Library" className="grid grid-cols-3 gap-4">
          <Stat label="Notes" value={annotationsQuery.isSuccess ? annotations.length : null} />
          <Stat
            label="Sermon notes"
            value={sermonNotesQuery.isSuccess ? sermonNotes.length : null}
          />
          <Stat label="Tags" value={tagsQuery.isSuccess ? (tagsQuery.data?.length ?? 0) : null} />
        </section>

        <section aria-label="Recent notes">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Recent notes
          </h3>
          {!notesLoaded && <p className="text-gray-500">Loading…</p>}
          {notesLoaded && recent.length === 0 && (
            <p className="text-gray-500">
              No notes yet —{" "}
              <Link to="/read" className="text-blue-700 hover:underline">
                open the reader
              </Link>{" "}
              and highlight a verse to begin.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {recent.map((r) => (
              <li
                key={`${r.kind}-${r.id}`}
                className="rounded border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                      r.kind === "sermon"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {r.kind === "sermon" ? "Sermon" : "Note"}
                  </span>
                  <span className="font-semibold">{noteReference(r.item, booksById)}</span>
                  <Link
                    to={readerLink(r.item)}
                    className="ml-auto text-sm text-blue-700 hover:underline"
                  >
                    Open
                  </Link>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {r.kind === "sermon" ? r.item.title : notePreview(r.item.note_markdown)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Go to" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {QUICK_LINKS.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-400 hover:shadow"
            >
              <div className="font-semibold text-blue-700">{q.title}</div>
              <p className="mt-1 text-sm text-gray-500">{q.blurb}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }): JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
      <div className="text-2xl font-bold tabular-nums">{value ?? "—"}</div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  );
}
