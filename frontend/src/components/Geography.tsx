import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PlaceLocation, StatusBadge } from "@/components/PlaceHonesty";
import { fetchPlaceVerses, fetchPlaces } from "@/lib/reader";
import type { Place } from "@/schemas";

interface GeographyProps {
  book: string;
  chapter: number;
  onJump: (book: string, chapter: number, verse: number) => void;
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
    <li className="rounded border border-gray-200 dark:border-gray-700 p-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-medium">{place.name}</span>
        <StatusBadge status={place.status} />
      </button>
      <div className="mt-0.5">
        <PlaceLocation place={place} />
      </div>
      {open && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          {versesQuery.isPending && <p className="text-xs text-gray-400 dark:text-gray-500">Loading verses…</p>}
          {versesQuery.isError && (
            <p className="text-xs text-red-600 dark:text-red-400">Couldn&rsquo;t load verses.</p>
          )}
          {versesQuery.data && (
            <ul className="flex flex-wrap gap-1">
              {versesQuery.data.map((v) => (
                <li key={`${v.book}-${v.chapter}-${v.verse}`}>
                  <button
                    type="button"
                    className="rounded border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700"
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

  if (query.isPending) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading places…</p>;
  if (query.isError)
    return <p className="text-sm text-red-600 dark:text-red-400">Couldn&rsquo;t load (is Concord reachable?).</p>;
  if (query.data.length === 0)
    return <p className="text-sm text-gray-500 dark:text-gray-400">No places named in this chapter.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {query.data.map((place) => (
        <PlaceRow key={place.id} place={place} onJump={onJump} />
      ))}
    </ul>
  );
}
