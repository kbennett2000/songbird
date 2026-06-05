import { useQuery } from "@tanstack/react-query";

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

export function StatusView(): JSX.Element {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const translations = useQuery({ queryKey: ["translations"], queryFn: fetchTranslations });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">songbird</h1>
        <p className="text-sm text-gray-500">Slice 0 — skeleton &amp; boot</p>
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Concord</h2>
        {health.isPending && <p className="text-gray-500">Checking Concord…</p>}
        {health.isError && (
          <p className="text-red-600">Could not reach songbird&rsquo;s health endpoint.</p>
        )}
        {health.data &&
          (health.data.concord.reachable ? (
            <p className="text-green-700">
              Reachable at <code>{health.data.concord.base_url}</code> —{" "}
              {health.data.concord.translation_count} translations.
            </p>
          ) : (
            <p className="text-red-600">
              Unreachable at <code>{health.data.concord.base_url}</code>:{" "}
              {health.data.concord.error}
            </p>
          ))}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Translations</h2>
        <p className="text-sm text-gray-500">Fetched via songbird → Concord.</p>
        {translations.isPending && <p className="text-gray-500">Loading…</p>}
        {translations.isError && (
          <p className="text-red-600">Failed to load translations (is Concord up?).</p>
        )}
        {translations.data && (
          <ul className="mt-2 list-disc pl-6">
            {translations.data.translations.map((t) => (
              <li key={t.id}>
                <span className="font-medium">{t.id}</span> — {t.name} ({t.language})
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
