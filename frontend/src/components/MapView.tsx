import { useQuery } from "@tanstack/react-query";
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BIBLE_WORLD_BOUNDS,
  FIT_MAX_ZOOM,
  MAX_BOUNDS,
  MAX_ZOOM,
  MIN_ZOOM,
} from "@/lib/map/config";
import { MAP_LABELS } from "@/lib/map/labels";
import { buildClusterBadge, buildLabelElement, buildPlaceLabel } from "@/lib/map/markers";
import { boundsForPlaces } from "@/lib/map/bounds";
import { partitionPlaces, placesToGeoJSON } from "@/lib/map/places";
import { buildStyle, MATCH_NONE } from "@/lib/map/style";
import { fetchPlaceVerses, fetchPlaces } from "@/lib/reader";
import type { Place } from "@/schemas";

interface MapViewProps {
  book: string;
  chapter: number;
  /** Jump the reader to a verse. In ReaderView this is `navigate`, which closes the modal. */
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** A cluster member as listed in the card — id + name is all the chooser needs. */
interface MemberRef {
  id: string;
  name: string;
}

// Register the pmtiles:// protocol exactly once, so the relief raster reads from the bundled,
// same-origin archive over HTTP Range (no tile server, no outbound call — ADR 0003).
let pmtilesRegistered = false;
function ensurePmtiles(): void {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

/** The card shown when a point is selected: name / status / confidence + the verses that name it. */
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

/** Shown when a numbered (cluster) pin is tapped: the places it stands for, each selectable. */
function ClusterCard({
  members,
  onPick,
}: {
  members: MemberRef[];
  onPick: (id: string) => void;
}): JSX.Element {
  return (
    <div data-testid="cluster-card" className="mt-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-sm">
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
        {members.length} places here — pick one:
      </p>
      <ul className="flex flex-wrap gap-1">
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              data-testid="cluster-member"
              className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-blue-700 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => onPick(m.id)}
            >
              {m.name}
            </button>
          </li>
        ))}
      </ul>
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

/** A small overlay control button (zoom is handled by MapLibre's NavigationControl). */
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
      className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 shadow hover:bg-white dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}

/**
 * The chapter's located places, plotted on a MapLibre map drawing natural-color relief + crisp
 * physical vectors from bundled, same-origin offline tiles (ADR 0003). Pins/clusters are GL circle
 * layers (tier-colored); cluster counts, curated labels, and per-pin place names are DOM markers
 * (so no glyph font is needed). The view auto-frames each chapter (fitBounds), can't be panned off
 * (maxBounds), and
 * clusters expand on click — listing their members so a tap reaches each place card.
 */
export function MapView({ book, chapter, onJump }: MapViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const labelMarkers = useRef<maplibregl.Marker[]>([]);
  const badgeMarkers = useRef<Record<string, maplibregl.Marker>>({});
  // Place-name labels beside each unclustered pin (issue #86), keyed by place id. Kept in sync
  // with the GL points the same way the cluster badges are — added/removed as clustering changes.
  const placeLabelMarkers = useRef<Record<string, maplibregl.Marker>>({});
  const [mapReady, setMapReady] = useState(false);
  // Set when the relief basemap fails to load (e.g. its bundled tiles aren't served with HTTP
  // Range). Without this the failure is silent — a blank map with no signal. Non-blocking: the
  // vectors + pins still render, so it's a small notice, not an error state.
  const [basemapError, setBasemapError] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clusterMembers, setClusterMembers] = useState<MemberRef[] | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  // The sync below runs on `moveend`/`data` (outside React), so it can't read `showLabels` from
  // closure freshly — mirror it into a ref so a label created mid-pan starts at the right visibility.
  const showLabelsRef = useRef(showLabels);

  const query = useQuery({
    queryKey: ["places", book, chapter],
    queryFn: () => fetchPlaces(book, chapter),
  });
  const data = query.data;
  const { located, unknown, offMap } = useMemo(
    () => (data ? partitionPlaces(data) : { located: [], unknown: [], offMap: [] }),
    [data],
  );

  // Keep the DOM markers in sync with the GL circles as clustering changes: a count badge over
  // each cluster, and a name label beside each unclustered pin (issue #86). Both are rebuilt on
  // `moveend`/`data` — a place that clusters loses its name (the badge's count stands in); when it
  // expands back to its own pin, the name returns. So names show exactly when there's room.
  const syncMapMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isSourceLoaded("places")) return;

    // Cluster-count badges.
    const clusters = map.querySourceFeatures("places", { filter: ["has", "point_count"] });
    const clusterIds = new Set<string>();
    for (const f of clusters) {
      const props = f.properties as { cluster_id: number; point_count: number };
      const id = String(props.cluster_id);
      if (clusterIds.has(id)) continue;
      clusterIds.add(id);
      if (!badgeMarkers.current[id] && f.geometry.type === "Point") {
        const el = buildClusterBadge(props.point_count);
        badgeMarkers.current[id] = new maplibregl.Marker({ element: el })
          .setLngLat(f.geometry.coordinates as [number, number])
          .addTo(map);
      }
    }
    for (const id of Object.keys(badgeMarkers.current)) {
      if (!clusterIds.has(id)) {
        badgeMarkers.current[id]?.remove();
        delete badgeMarkers.current[id];
      }
    }

    // Place-name labels beside each unclustered pin.
    const points = map.querySourceFeatures("places", { filter: ["!", ["has", "point_count"]] });
    const placeIds = new Set<string>();
    for (const f of points) {
      const props = f.properties as { id: string; name: string };
      if (placeIds.has(props.id)) continue;
      placeIds.add(props.id);
      if (!placeLabelMarkers.current[props.id] && f.geometry.type === "Point") {
        const el = buildPlaceLabel(props.name);
        if (!showLabelsRef.current) el.style.display = "none";
        // anchor "left" + a small x-offset seats the name just right of the ~8px pin radius.
        placeLabelMarkers.current[props.id] = new maplibregl.Marker({
          element: el,
          anchor: "left",
          offset: [10, 0],
        })
          .setLngLat(f.geometry.coordinates as [number, number])
          .addTo(map);
      }
    }
    for (const id of Object.keys(placeLabelMarkers.current)) {
      if (!placeIds.has(id)) {
        placeLabelMarkers.current[id]?.remove();
        delete placeLabelMarkers.current[id];
      }
    }
  }, []);

  const handlePointClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) return;
    setSelectedId((f.properties as { id: string }).id);
    setClusterMembers(null);
  }, []);

  const handleClusterClick = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current;
    const f = e.features?.[0];
    if (!map || !f || f.geometry.type !== "Point") return;
    const src = map.getSource("places") as GeoJSONSource;
    const clusterId = (f.properties as { cluster_id: number }).cluster_id;
    const center = f.geometry.coordinates as [number, number];
    // Clear any open single-place card, list the members, and zoom to expand.
    setSelectedId(null);
    void src
      .getClusterLeaves(clusterId, 100, 0)
      .then((leaves) =>
        setClusterMembers(
          leaves.map((l) => ({
            id: (l.properties as { id: string }).id,
            name: (l.properties as { name: string }).name,
          })),
        ),
      )
      .catch(() => {});
    void src
      .getClusterExpansionZoom(clusterId)
      .then((zoom) => map.easeTo({ center, zoom }))
      .catch(() => {});
  }, []);

  // Create the map once.
  useEffect(() => {
    ensurePmtiles();
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(window.location.origin),
      bounds: BIBLE_WORLD_BOUNDS,
      maxBounds: MAX_BOUNDS,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.touchZoomRotate.disableRotation();

    const setPointer = (on: boolean) => () => {
      map.getCanvas().style.cursor = on ? "pointer" : "";
    };

    // Surface load failures instead of failing to a silent blank map. MapLibre fires `error` with
    // a `sourceId` when a source/tile can't load — the relief basemap reads its bundled pmtiles
    // over HTTP Range, so a deploy that doesn't serve Range (or a missing/stale tile asset) lands
    // here. Log every error; flag the relief one so the user gets a visible note (ADR 0003).
    map.on("error", (e) => {
      const ev = e as { error?: { message?: string }; sourceId?: string };
      console.error(
        `[map] ${ev.sourceId ? `source "${ev.sourceId}": ` : ""}${ev.error?.message ?? "error"}`,
        e,
      );
      if (ev.sourceId === "relief") setBasemapError(true);
    });

    map.on("load", () => {
      for (const l of MAP_LABELS) {
        const m = new maplibregl.Marker({ element: buildLabelElement(l.name, l.kind) })
          .setLngLat([l.lon, l.lat])
          .addTo(map);
        labelMarkers.current.push(m);
      }
      map.on("click", "unclustered-point", handlePointClick);
      map.on("click", "clusters", handleClusterClick);
      map.on("mouseenter", "unclustered-point", setPointer(true));
      map.on("mouseleave", "unclustered-point", setPointer(false));
      map.on("mouseenter", "clusters", setPointer(true));
      map.on("mouseleave", "clusters", setPointer(false));
      map.on("moveend", syncMapMarkers);
      map.on("data", (e) => {
        const ev = e as { sourceId?: string; isSourceLoaded?: boolean };
        if (ev.sourceId === "places" && ev.isSourceLoaded) syncMapMarkers();
      });
      // The modal lays out around us; make sure the GL canvas matches the final container size.
      map.resize();
      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      labelMarkers.current = [];
      badgeMarkers.current = {};
      placeLabelMarkers.current = {};
      setMapReady(false);
    };
  }, [handlePointClick, handleClusterClick, syncMapMarkers]);

  // Feed the chapter's places to the source and frame them (per-chapter auto-fit).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("places") as GeoJSONSource).setData(placesToGeoJSON(located));
    map.fitBounds(boundsForPlaces(located) ?? BIBLE_WORLD_BOUNDS, {
      padding: 48,
      maxZoom: FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [located, mapReady]);

  // The selection ring follows the selected place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setFilter("selected-point", selectedId ? ["==", ["get", "id"], selectedId] : MATCH_NONE);
  }, [selectedId, mapReady]);

  // Labels on/off — the one "Aa" control drives both the curated context labels and the place
  // names (issue #86). Mirror the flag into the ref so the move-driven sync agrees.
  useEffect(() => {
    showLabelsRef.current = showLabels;
    const display = showLabels ? "" : "none";
    for (const m of labelMarkers.current) m.getElement().style.display = display;
    for (const m of Object.values(placeLabelMarkers.current)) m.getElement().style.display = display;
  }, [showLabels, mapReady]);

  // Clear selection when the chapter changes (no stale card from the previous chapter).
  useEffect(() => {
    setSelectedId(null);
    setClusterMembers(null);
  }, [book, chapter]);

  const fitChapter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(boundsForPlaces(located) ?? BIBLE_WORLD_BOUNDS, { padding: 48, maxZoom: FIT_MAX_ZOOM });
  }, [located]);

  const selected = located.find((p) => p.id === selectedId) ?? null;

  // The basemap (relief + vectors) always renders; the places query only populates pins/lists, so
  // its loading/error states are notes below the map — never an early return that would unmount the
  // map container before the (once-only) creation effect can attach to it.
  return (
    <div>
      <div className="relative w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700 h-[70vh] max-h-[560px] min-h-[360px]">
        {/* h-full (not absolute inset-0): MapLibre sets .maplibregl-map{position:relative}, which
            would override `absolute` and collapse an inset-0 box to height 0. */}
        <div ref={containerRef} data-testid="map-canvas" className="h-full w-full" />
        <div className="absolute left-2 top-2 z-10 flex flex-col gap-1">
          <ControlButton label="Fit chapter" onClick={fitChapter}>
            ⤢
          </ControlButton>
          <ControlButton
            label={showLabels ? "Hide labels" : "Show labels"}
            onClick={() => setShowLabels((v) => !v)}
          >
            <span className={showLabels ? "" : "opacity-40"}>Aa</span>
          </ControlButton>
        </div>
        {basemapError && (
          <div
            role="status"
            className="absolute inset-x-2 bottom-2 z-10 rounded border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-center text-xs text-amber-800 shadow dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-200"
          >
            The map terrain didn’t load. Places still work — check the browser console for details.
          </div>
        )}
      </div>

      {query.isPending && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading places…</p>}
      {query.isError && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          Couldn&rsquo;t load places (is Concord reachable?).
        </p>
      )}

      {selected && <PlaceCard place={selected} onJump={onJump} />}
      {!selected && clusterMembers && (
        <ClusterCard members={clusterMembers} onPick={(id) => {
          setSelectedId(id);
          setClusterMembers(null);
        }} />
      )}

      <PlaceList label="Also mentioned, location unknown" places={unknown} />
      <PlaceList label="Off this map" places={offMap} />

      {located.length === 0 && (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No places in this chapter fall on the map.</p>
      )}
    </div>
  );
}
