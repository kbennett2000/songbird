import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { TopicVerseList } from "@/components/TopicVerseList";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { fetchTopic } from "@/lib/reader";

const DEFAULT_TRANSLATION = "KJV";

/** A single topic: its header (name, section, its topical index, verse count) and its verses (jump
 * to read). A `see_also` topic is a "See X" redirect — it carries no verses, so we link to the
 * target instead, by the target's name. Errors surface (primary content). */
export function TopicDetailView(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  // Verse text needs a translation; use the profile's last-used (the reader's default).
  const translation = user?.last_translation ?? DEFAULT_TRANSLATION;

  const topicQuery = useQuery({
    queryKey: ["topic", id],
    queryFn: () => fetchTopic(id),
    retry: false,
  });

  const notFound = topicQuery.error instanceof ApiError && topicQuery.error.status === 404;
  const topic = topicQuery.data;

  // A redirect names its target by id; show the target's name. Same cache entry as the target's
  // own page, so following the link asks nothing more. A target Concord lacks (some of Nave's do)
  // or a failure keeps the id, so the link still goes where it did.
  const seeAlso = topic?.see_also ?? null;
  const target = useQuery({
    queryKey: ["topic", seeAlso],
    queryFn: () => fetchTopic(seeAlso!),
    enabled: seeAlso !== null,
    retry: false,
  });
  const seeName = target.isPending ? "…" : (target.data?.name ?? seeAlso);

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-900">
      <TopNav />

      <main className="mx-auto max-w-3xl p-6">
        <Link to="/topics" className="text-sm text-blue-700 dark:text-blue-400 hover:underline">
          ← All topics
        </Link>
        {topicQuery.isPending && <p className="text-gray-500 dark:text-gray-400">Loading topic…</p>}

        {notFound && (
          <p className="text-gray-500 dark:text-gray-400">That topic doesn&rsquo;t exist.</p>
        )}
        {topicQuery.isError && !notFound && (
          <p className="text-red-600 dark:text-red-400">
            Couldn&rsquo;t load this topic (is Concord reachable?).
          </p>
        )}

        {topic && (
          <>
            <h1 className="text-2xl font-bold tracking-tight">{topic.name}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {topic.section}
              {topic.source && ` · ${topic.source}`}
            </p>

            {topic.see_also ? (
              // A redirect topic — carries no verses of its own; point at the target.
              <p className="mt-4">
                →{" "}
                <Link
                  to={`/topics/${topic.see_also}`}
                  className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                >
                  See {seeName}
                </Link>
              </p>
            ) : (
              <>
                <h2 className="mb-2 mt-6 text-lg font-semibold">
                  Verses{" "}
                  <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                    ({topic.verse_count})
                  </span>
                </h2>
                <TopicVerseList
                  topicId={id}
                  translation={translation}
                  onJump={(b, c, v) => navigate(`/read?book=${b}&chapter=${c}&verse=${v}`)}
                />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
