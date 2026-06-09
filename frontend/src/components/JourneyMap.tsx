import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { useEffect, useMemo, useRef, useState } from "react";

import { boundsForCoords } from "@/lib/map/bounds";
import { BIBLE_WORLD_BOUNDS, FIT_MAX_ZOOM, MAX_BOUNDS, MAX_ZOOM, MIN_ZOOM } from "@/lib/map/config";
import { stopsToRoute } from "@/lib/map/journey";
import { buildStyle } from "@/lib/map/style";
import type { JourneyStop } from "@/schemas";

interface JourneyMapProps {
  stops: JourneyStop[];
  /** Jump to a stop's scripture passage. The detail view resolves the human reference, then navigates. */
  onJump: (reference: string) => void;
}

// Register the pmtiles:// protocol once (shared bundled relief archive — ADR 0003), same as MapView.
let pmtilesRegistered = false;
function ensurePmtiles(): void {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

/** A numbered, clickable route marker (interactive — unlike the map's other DOM markers). */
function buildJourneyMarker(ordinal: number): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.testid = "journey-marker";
  el.dataset.ordinal = String(ordinal);
  el.className =
    "flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-600 " +
    "text-xs font-bold text-white shadow cursor-pointer";
  el.textContent = String(ordinal);
  return el;
}

/**
 * A journey's route on the shared base map (ADR 0003 relief + physical vectors). Unlike MapView,
 * this draws an ordered LINE through the journey's located stops with numbered markers — no
 * clustering, no chapter fetch. The honesty filtering (unlocated stops dropped, never a guessed
 * pin) lives in the pure `stopsToRoute`; this component is the thin MapLibre glue. A numbered
 * marker → its stop's scripture reference (when present) via `onJump`.
 */
export function JourneyMap({ stops, onJump }: JourneyMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [basemapError, setBasemapError] = useState(false);

  const { route, markers } = useMemo(() => stopsToRoute(stops), [stops]);

  // Marker click → the stop's reference (when present) → onJump. Read through refs so a marker
  // built in the geometry effect always sees the latest props without rebuilding on every render.
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const refByOrdinal = useMemo(() => {
    const m = new Map<number, string | null>();
    for (const s of stops) m.set(s.ordinal, s.reference);
    return m;
  }, [stops]);
  const refByOrdinalRef = useRef(refByOrdinal);
  refByOrdinalRef.current = refByOrdinal;

  // Create the map once (mirrors MapView's base-map setup).
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

    // Surface basemap load failures instead of a silent blank map (ADR 0003), like MapView.
    map.on("error", (e) => {
      const ev = e as { error?: { message?: string }; sourceId?: string };
      console.error(
        `[map] ${ev.sourceId ? `source "${ev.sourceId}": ` : ""}${ev.error?.message ?? "error"}`,
        e,
      );
      if (ev.sourceId === "relief") setBasemapError(true);
    });

    map.on("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
          properties: {},
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1d4ed8", "line-width": 2.5 },
      });
      map.resize();
      setMapReady(true);
    });

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Feed the route line + numbered markers and frame the located stops. Unlocated stops never
  // appear (filtered out of `route`/`markers` by stopsToRoute).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("route") as GeoJSONSource).setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route },
      properties: {},
    });

    for (const m of markersRef.current) m.remove();
    markersRef.current = markers.map((mk) => {
      const el = buildJourneyMarker(mk.ordinal);
      el.addEventListener("click", () => {
        const reference = refByOrdinalRef.current.get(mk.ordinal);
        if (reference) onJumpRef.current(reference);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([mk.lng, mk.lat]).addTo(map);
    });

    map.fitBounds(boundsForCoords(route) ?? BIBLE_WORLD_BOUNDS, {
      padding: 48,
      maxZoom: FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [route, markers, mapReady]);

  return (
    <div className="relative w-full overflow-hidden rounded border border-gray-200 dark:border-gray-700 h-[60vh] max-h-[520px] min-h-[320px]">
      <div ref={containerRef} data-testid="journey-map-canvas" className="h-full w-full" />
      {basemapError && (
        <div
          role="status"
          className="absolute inset-x-2 bottom-2 z-10 rounded border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-center text-xs text-amber-800 shadow dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-200"
        >
          The map terrain didn’t load. The route still works — check the browser console for
          details.
        </div>
      )}
    </div>
  );
}
