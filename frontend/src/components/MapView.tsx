import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import mapUrl from "@/assets/bible-map.png";
import { projectPercent } from "@/lib/projection";
import { fetchPlaceVerses, fetchPlaces } from "@/lib/reader";
import type { Place } from "@/schemas";

interface MapViewProps {
  book: string;
  chapter: number;
  /** Jump the reader to a verse. In ReaderView this is `navigate`, which closes the modal. */
  onJump: (book: string, chapter: number, verse: number) => void;
}

type ConfidenceTier = "solid" | "hollow" | "disputed";

/**
 * Map a place's status/confidence to a marker tier — the honesty model, made visual.
 * Confidence is the primary signal (a medium-confidence place reads as less certain even if it's
 * "identified"); status only decides when Concord gives no confidence value.
 */
function tierFor(place: Place): ConfidenceTier {
  if (place.status === "disputed") return "disputed";
  if (place.confidence === "high") return "solid";
  if (place.confidence === "medium" || place.confidence === "low") return "hollow";
  return place.status === "identified" ? "solid" : "hollow";
}

const MARKER_CLASS: Record<ConfidenceTier, string> = {
  solid: "border-blue-700 bg-blue-600 text-white",
  hollow: "border-blue-400 bg-white dark:bg-gray-800 text-blue-400 opacity-80",
  disputed: "border-amber-600 bg-white dark:bg-gray-800 text-amber-700",
};

interface PositionedPin {
  place: Place;
  leftPct: number;
  topPct: number;
}

/**
 * Split the chapter's places into pins (located + in-bounds), an "off this map" list
 * (located but outside the atlas extent), and an "unknown" list (no coordinates — never a
 * fabricated pin). Colliding pins get a small deterministic offset so dense areas stay tappable.
 */
function layout(places: Place[]): {
  pins: PositionedPin[];
  offMap: Place[];
  unknown: Place[];
} {
  const pins: PositionedPin[] = [];
  const offMap: Place[] = [];
  const unknown: Place[] = [];

  for (const place of places) {
    if (place.latitude === null || place.longitude === null) {
      unknown.push(place);
      continue;
    }
    const pos = projectPercent(place.latitude, place.longitude);
    if (pos === null) {
      offMap.push(place);
      continue;
    }
    pins.push({ place, leftPct: pos.leftPct, topPct: pos.topPct });
  }

  // Deterministic golden-angle spiral offset for pins sharing a coarse cell (overlap, first cut).
  const CELL = 3; // percent
  const seen = new Map<string, number>();
  const spread = pins.map((pin) => {
    const key = `${Math.round(pin.leftPct / CELL)}-${Math.round(pin.topPct / CELL)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return pin;
    const angle = n * 2.399;
    const radius = 1.2 * Math.sqrt(n);
    return {
      place: pin.place,
      leftPct: pin.leftPct + radius * Math.cos(angle),
      topPct: pin.topPct + radius * Math.sin(angle),
    };
  });

  return { pins: spread, offMap, unknown };
}

/** The card shown when a pin is tapped: name / status / confidence + the verses that name it. */
function PlaceCard({
  place,
  onJump,
}: {
  place: Place;
  onJump: MapViewProps["onJump"];
}): JSX.Element {
  const versesQuery = useQuery({
    queryKey: ["place-verses", place.id],
    queryFn: () => fetchPlaceVerses(place.id),
  });

  return (
    <div data-testid="place-card" className="mt-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{place.name}</span>
        <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-xs text-gray-600 dark:text-gray-300">{place.status}</span>
        {place.confidence && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{place.confidence} confidence</span>
        )}
      </div>
      <div className="mt-2">
        <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Jump to verses:</p>
        {versesQuery.isPending && <p className="text-xs text-gray-400 dark:text-gray-500">Loading verses…</p>}
        {versesQuery.isError && <p className="text-xs text-red-600 dark:text-red-400">Couldn&rsquo;t load verses.</p>}
        {versesQuery.data && (
          <ul className="flex flex-wrap gap-1">
            {versesQuery.data.map((v) => (
              <li key={`${v.book}-${v.chapter}-${v.verse}`}>
                <button
                  type="button"
                  className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-blue-700 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  onClick={() => onJump(v.book, v.chapter, v.verse)}
                >
                  {v.reference}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A line like "Off this map: Tarshish" — shown only when the list is non-empty. */
function PlaceList({ label, places }: { label: string; places: Place[] }): JSX.Element | null {
  if (places.length === 0) return null;
  return (
    <p className="mt-2 text-sm italic text-gray-400 dark:text-gray-500">
      {label}: {places.map((p) => p.name).join(", ")}
    </p>
  );
}

/**
 * The chapter's located places, plotted on the bundled offline atlas. Confidence is encoded
 * visually; unknown and off-extent places are listed (never plotted, never fabricated). Tapping a
 * pin selects it (no hover dependence — mobile-first); selecting a verse jumps the reader.
 */
export function MapView({ book, chapter, onJump }: MapViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["places", book, chapter],
    queryFn: () => fetchPlaces(book, chapter),
  });

  if (query.isPending) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading places…</p>;
  if (query.isError)
    return <p className="text-sm text-red-600 dark:text-red-400">Couldn&rsquo;t load (is Concord reachable?).</p>;

  const { pins, offMap, unknown } = layout(query.data);
  const selected = pins.find((p) => p.place.id === selectedId)?.place ?? null;

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700 aspect-[5/4]">
        <img src={mapUrl} alt="Map of the biblical world" className="absolute inset-0 h-full w-full" />
        {pins.map((pin) => {
          const tier = tierFor(pin.place);
          const isSelected = pin.place.id === selectedId;
          return (
            <button
              key={pin.place.id}
              type="button"
              data-testid="map-pin"
              data-place-id={pin.place.id}
              data-tier={tier}
              aria-label={pin.place.name}
              title={pin.place.name}
              onClick={() => setSelectedId(pin.place.id)}
              style={{ left: `${pin.leftPct}%`, top: `${pin.topPct}%` }}
              className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold shadow ${
                MARKER_CLASS[tier]
              } ${isSelected ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
            >
              {tier === "disputed" ? "?" : ""}
            </button>
          );
        })}
      </div>

      {selected && <PlaceCard place={selected} onJump={onJump} />}

      <PlaceList label="Also mentioned, location unknown" places={unknown} />
      <PlaceList label="Off this map" places={offMap} />

      {pins.length === 0 && (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No places in this chapter fall on the map.</p>
      )}
    </div>
  );
}
