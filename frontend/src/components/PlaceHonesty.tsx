import type { Place } from "@/schemas";

/**
 * Concord's honesty model, made visual — ONE home so the per-chapter map (Geography) and the
 * gazetteer render it identically. Never a fabricated coordinate: unknown/symbolic places show
 * "Location unknown", and the status badge always reflects Concord's own classification.
 */

const STATUS_BADGE: Record<string, string> = {
  identified: "bg-green-100 text-green-800",
  disputed: "bg-amber-100 text-amber-800",
  unknown: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
  symbolic: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
  multiple: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
};

/** Concord's status as a small coloured badge (falls back to the neutral style for any new value). */
export function StatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[status] ?? STATUS_BADGE.unknown}`}>
      {status}
    </span>
  );
}

/** identified → coordinates; disputed → coordinates marked contested; unknown/symbolic →
 * "Location unknown", never a fabricated pin. */
export function PlaceLocation({ place }: { place: Place }): JSX.Element {
  if (place.latitude === null || place.longitude === null) {
    return <span className="text-sm italic text-gray-400 dark:text-gray-500">Location unknown</span>;
  }
  return (
    <span className="text-sm text-gray-600 dark:text-gray-300">
      {place.latitude.toFixed(2)}, {place.longitude.toFixed(2)}
      {place.confidence && <span className="text-gray-400 dark:text-gray-500"> · {place.confidence} confidence</span>}
      {place.status === "disputed" && <span className="text-amber-700"> · contested</span>}
    </span>
  );
}
