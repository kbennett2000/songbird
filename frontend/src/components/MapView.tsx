import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import mapUrl from "@/assets/bible-map.png";
import { cluster } from "@/lib/cluster";
import { MAP_PX } from "@/lib/mapBounds";
import { project } from "@/lib/projection";
import {
  applyZoomAt,
  fitToBounds,
  screenPos,
  type ImagePoint,
  type Size,
  type Transform,
} from "@/lib/mapTransform";
import { fetchPlaceVerses, fetchPlaces } from "@/lib/reader";
import type { Place } from "@/schemas";

interface MapViewProps {
  book: string;
  chapter: number;
  /** Jump the reader to a verse. In ReaderView this is `navigate`, which closes the modal. */
  onJump: (book: string, chapter: number, verse: number) => void;
}

type ConfidenceTier = "solid" | "hollow" | "disputed";

/** Pixels within which two pins collapse into a cluster (screen space). */
const CLUSTER_RADIUS_PX = 28;

/** Fallback container size before/without a real measurement (e.g. in tests). 5:4, like the atlas. */
const DEFAULT_SIZE: Size = { width: 500, height: 400 };

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

/** A located, in-bounds place with its position in image space (0..MAP_PX). */
interface PlacePoint extends ImagePoint {
  place: Place;
}

/**
 * Split the chapter's places into located in-bounds points, an "off this map" list (located but
 * outside the atlas extent), and an "unknown" list (no coordinates — never a fabricated pin).
 * Overlap is handled at render time by clustering, not by nudging pins — so this is pure math.
 */
function layout(places: Place[]): {
  points: PlacePoint[];
  offMap: Place[];
  unknown: Place[];
} {
  const points: PlacePoint[] = [];
  const offMap: Place[] = [];
  const unknown: Place[] = [];

  for (const place of places) {
    if (place.latitude === null || place.longitude === null) {
      unknown.push(place);
      continue;
    }
    const px = project(place.latitude, place.longitude);
    if (px === null) {
      offMap.push(place);
      continue;
    }
    points.push({ place, x: px.x, y: px.y });
  }

  return { points, offMap, unknown };
}

/** Measure a container and keep its CSS-pixel size in sync as it resizes. */
function useContainerSize(): [React.RefObject<HTMLDivElement>, Size] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
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

/** A small round control button for the zoom toolbar. */
function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 shadow hover:bg-white dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}

/**
 * The chapter's located places, plotted on the bundled offline atlas. The view auto-frames each
 * chapter to its own places (so chapters look distinct), can be panned and zoomed entirely
 * client-side (no tile service — the offline promise is intact), and collapses overlapping pins
 * into clusters that split apart as you zoom in. Confidence is encoded visually; unknown and
 * off-extent places are listed (never plotted, never fabricated).
 */
export function MapView({ book, chapter, onJump }: MapViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [containerRef, size] = useContainerSize();
  const [transform, setTransform] = useState<Transform | null>(null);

  const query = useQuery({
    queryKey: ["places", book, chapter],
    queryFn: () => fetchPlaces(book, chapter),
  });

  const effSize = useMemo<Size>(
    () => (size.width > 0 && size.height > 0 ? size : DEFAULT_SIZE),
    [size],
  );

  const data = query.data;
  const { points, offMap, unknown } = useMemo(
    () => (data ? layout(data) : { points: [], offMap: [], unknown: [] }),
    [data],
  );

  // Auto-frame the chapter to its own places — refit when the chapter or the container changes.
  const fitKey = `${book}:${chapter}`;
  useEffect(() => {
    if (!data) return;
    setTransform(fitToBounds(points, effSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, data, effSize.width, effSize.height]);

  // Latest transform/size for the non-passive wheel listener, without rebinding it each render.
  const transformRef = useRef<Transform | null>(transform);
  transformRef.current = transform;
  const sizeRef = useRef<Size>(effSize);
  sizeRef.current = effSize;

  const zoomBy = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    setTransform((t) => {
      if (!t) return t;
      const c = sizeRef.current;
      const center = anchor ?? { x: c.width / 2, y: c.height / 2 };
      return applyZoomAt(t, factor, center, c);
    });
  }, []);

  // Wheel-to-zoom. Bound manually as non-passive so we can preventDefault the page scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!transformRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, zoomBy]);

  // Pointer-driven pan + pinch-zoom. Pointers are tracked so two-finger pinch can zoom on touch.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | null>(null);

  const onPointerDown = (e: React.PointerEvent): void => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };

    if (pointers.current.size >= 2) {
      // Pinch: zoom by the change in distance between the first two pointers, about their midpoint.
      pointers.current.set(e.pointerId, cur);
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current !== null && pinchDist.current > 0) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
        zoomBy(dist / pinchDist.current, mid);
      }
      pinchDist.current = dist;
      return;
    }

    // Single pointer: pan by the drag delta.
    pointers.current.set(e.pointerId, cur);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    setTransform((t) => (t ? { ...t, tx: t.tx + dx, ty: t.ty + dy } : t));
  };

  const endPointer = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
  };

  if (query.isPending) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading places…</p>;
  if (query.isError)
    return <p className="text-sm text-red-600 dark:text-red-400">Couldn&rsquo;t load (is Concord reachable?).</p>;

  const t = transform ?? fitToBounds(points, effSize);
  const clusters = cluster(points, t, CLUSTER_RADIUS_PX);
  const selected = points.find((p) => p.place.id === selectedId)?.place ?? null;

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        className="relative w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700 aspect-[5/4] touch-none cursor-grab active:cursor-grabbing"
      >
        {/* Base layer: the atlas, transformed (translate + scale). Pins ride a separate layer. */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: MAP_PX.width,
            height: MAP_PX.height,
            transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`,
            pointerEvents: "none",
          }}
        >
          <img src={mapUrl} alt="Map of the biblical world" className="h-full w-full" draggable={false} />
        </div>

        {/* Marker layer: not scaled, so pins stay a constant size; only their positions move. */}
        <div className="pointer-events-none absolute inset-0">
          {clusters.map((c) => {
            const pos = screenPos(c, t);
            const first = c.members[0];
            if (first && c.members.length === 1) {
              const { place } = first;
              const tier = tierFor(place);
              const isSelected = place.id === selectedId;
              return (
                <button
                  key={place.id}
                  type="button"
                  data-testid="map-pin"
                  data-place-id={place.id}
                  data-tier={tier}
                  aria-label={place.name}
                  title={place.name}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelectedId(place.id)}
                  style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
                  className={`pointer-events-auto absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold shadow ${
                    MARKER_CLASS[tier]
                  } ${isSelected ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                >
                  {tier === "disputed" ? "?" : ""}
                </button>
              );
            }
            const key = c.members.map((m) => m.place.id).join("+");
            return (
              <button
                key={key}
                type="button"
                data-testid="map-cluster"
                data-count={c.members.length}
                aria-label={`${c.members.length} clustered places`}
                title={c.members.map((m) => m.place.name).join(", ")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setTransform(fitToBounds(c.members, sizeRef.current))}
                style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
                className="pointer-events-auto absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-blue-700 bg-blue-600 text-xs font-bold text-white shadow"
              >
                {c.members.length}
              </button>
            );
          })}
        </div>

        {/* Zoom toolbar. */}
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <ControlButton label="Zoom in" onClick={() => zoomBy(1.3)}>
            +
          </ControlButton>
          <ControlButton label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
            −
          </ControlButton>
          <ControlButton label="Fit chapter" onClick={() => setTransform(fitToBounds(points, sizeRef.current))}>
            ⤢
          </ControlButton>
        </div>
      </div>

      {selected && <PlaceCard place={selected} onJump={onJump} />}

      <PlaceList label="Also mentioned, location unknown" places={unknown} />
      <PlaceList label="Off this map" places={offMap} />

      {points.length === 0 && (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No places in this chapter fall on the map.</p>
      )}
    </div>
  );
}
