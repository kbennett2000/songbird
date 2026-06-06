import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchPlaceVerses, fetchPlaces } from "@/lib/reader";
import type { Place } from "@/schemas";

interface GeographyProps {
  book: string;
  chapter: number;
  onJump: (book: string, chapter: number, verse: number) => void;
}

const STATUS_BADGE: Record<string, string> = {
  identified: "bg-green-100 text-green-800",
  disputed: "bg-amber-100 text-amber-800",
  unknown: "bg-gray-100 text-gray-600",
  symbolic: "bg-gray-100 text-gray-600",
  multiple: "bg-gray-100 text-gray-600",
};

/** Carry Concord's honesty model through to the UI: identified → coordinates; disputed →
 * coordinates marked contested; unknown/symbolic → "Location unknown", never a fabricated pin. */
function Location({ place }: { place: Place }): JSX.Element {
  if (place.latitude === null || place.longitude === null) {
    return <span className="text-sm italic text-gray-400">Location unknown</span>;
  }
  return (
    <span className="text-sm text-gray-600">
      {place.latitude.toFixed(2)}, {place.longitude.toFixed(2)}
      {place.confidence && <span className="text-gray-400"> · {place.confidence} confidence</span>}
      {place.status === "disputed" && <span className="text-amber-700"> · contested</span>}
    </span>
  );
}

function PlaceRow({
  place,
  onJump,
}: {
  place: Place;
  onJump: GeographyProps["onJump"];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const versesQuery = useQuery({
    queryKey: ["place-verses", place.id],
    queryFn: () => fetchPlaceVerses(place.id),
    enabled: open,
  });

  return (
    <li className="rounded border border-gray-200 p-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-medium">{place.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[place.status] ?? STATUS_BADGE.unknown}`}>
          {place.status}
        </span>
      </button>
      <div className="mt-0.5">
        <Location place={place} />
      </div>
      {open && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          {versesQuery.isPending && <p className="text-xs text-gray-400">Loading verses…</p>}
          {versesQuery.isError && (
            <p className="text-xs text-red-600">Couldn&rsquo;t load verses.</p>
          )}
          {versesQuery.data && (
            <ul className="flex flex-wrap gap-1">
              {versesQuery.data.map((v) => (
                <li key={`${v.book}-${v.chapter}-${v.verse}`}>
                  <button
                    type="button"
                    className="rounded border border-gray-200 px-2 py-0.5 text-xs text-blue-700 hover:bg-gray-50"
                    onClick={() => onJump(v.book, v.chapter, v.verse)}
                  >
                    {v.reference}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Places named in the chapter — sourced entirely from Concord, with its honesty model carried
 * through. Click a place to see (and jump to) the verses that name it. */
export function Geography({ book, chapter, onJump }: GeographyProps): JSX.Element {
  const query = useQuery({
    queryKey: ["places", book, chapter],
    queryFn: () => fetchPlaces(book, chapter),
  });

  if (query.isPending) return <p className="text-sm text-gray-500">Loading places…</p>;
  if (query.isError)
    return <p className="text-sm text-red-600">Couldn&rsquo;t load (is Concord reachable?).</p>;
  if (query.data.length === 0)
    return <p className="text-sm text-gray-500">No places named in this chapter.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((place) => (
        <PlaceRow key={place.id} place={place} onJump={onJump} />
      ))}
    </ul>
  );
}
