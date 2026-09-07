import { useQuery } from "@tanstack/react-query";

import { TopNav } from "@/components/TopNav";
import { apiRequest } from "@/lib/api";
import { healthResponseSchema, translationsResponseSchema } from "@/schemas";

async function fetchHealth() {
  // /healthz is songbird's unprefixed liveness + Concord-reachability report.
  const response = await fetch("/healthz", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`healthz responded ${response.status}`);
  }
  return healthResponseSchema.parse(await response.json());
}

async function fetchTranslations() {
  // Goes through songbird's own API, which calls Concord over HTTP.
  const data = await apiRequest<unknown>("GET", "/translations");
  return translationsResponseSchema.parse(data);
}

/**
 * Where songbird's Scripture is coming from.
 *
 * songbird has no Bible of its own — every verse, search and map comes from whichever Concord
 * `CONCORD_BASE_URL` names. That makes the address load-bearing and, on its own, invisible: point
 * songbird at a different Concord and nothing errors, nothing looks broken, and the only trace is
 * that the translations you expected aren't in the list. So this page leads with the address and
 * the corpus together — the two facts that only mean something side by side.
 */
export function StatusView(): JSX.Element {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const translations = useQuery({ queryKey: ["translations"], queryFn: fetchTranslations });

  const concord = health.data?.concord;

  return (
    <>
      <TopNav maxWidth="max-w-3xl" />
      <main className="mx-auto max-w-3xl p-4">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Scripture source</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            songbird keeps your notes. The Bible text, the search and the maps all come from
            Concord — this is the one songbird is reading.
          </p>
        </header>

        <section className="mt-6 rounded border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-lg font-semibold">Concord</h2>

          {health.isPending && (
            <p className="mt-2 text-gray-500 dark:text-gray-400">Checking Concord…</p>
          )}

          {health.isError && (
            <p className="mt-2 text-red-600 dark:text-red-400">
              Could not reach songbird&rsquo;s health endpoint.
            </p>
          )}

          {concord && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-500 dark:text-gray-400">Address</dt>
              <dd>
                <code className="break-all">{concord.base_url}</code>
              </dd>

              <dt className="text-gray-500 dark:text-gray-400">Status</dt>
              <dd>
                {concord.reachable ? (
                  <span className="text-green-700 dark:text-green-400">Connected</span>
                ) : (
                  <span className="text-red-600 dark:text-red-400">
                    Not reachable — {concord.error}
                  </span>
                )}
              </dd>

              {concord.reachable && concord.translation_count !== null && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">Translations</dt>
                  <dd>{concord.translation_count} available here</dd>
                </>
              )}

              <dt className="text-gray-500 dark:text-gray-400">songbird</dt>
              <dd>version {health.data?.version}</dd>
            </dl>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-semibold">Translations this Concord serves</h2>
          {/* Named here, at the moment someone is looking for one that's missing — which is the
              only moment the explanation is worth reading. */}
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            This is the whole list songbird can offer. If one you expect is missing, it isn&rsquo;t
            missing from songbird — it isn&rsquo;t in the Concord above. Point{" "}
            <code>CONCORD_BASE_URL</code> at a Concord that carries it.
          </p>

          {translations.isPending && (
            <p className="mt-2 text-gray-500 dark:text-gray-400">Loading…</p>
          )}
          {translations.isError && (
            <p className="mt-2 text-red-600 dark:text-red-400">
              Failed to load translations (is Concord up?).
            </p>
          )}
          {translations.data && (
            <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-700 text-sm">
              {translations.data.translations.map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                  <span className="font-mono font-medium">{t.id}</span>
                  <span>{t.name}</span>
                  <span className="text-gray-500 dark:text-gray-400">({t.language})</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
