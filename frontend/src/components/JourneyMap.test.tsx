import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JourneyStop } from "@/schemas";

// MapLibre needs WebGL (unavailable in happy-dom), so we mock it and assert the *wiring*: the route
// source is fed the filtered/ordered coords, one marker per located stop, and a marker click with a
// reference calls onJump. Real GL rendering is the manual/Playwright gate. Mirrors MapView.test.

const created: FakeMap[] = [];
const markers: FakeMarker[] = [];

class FakeSource {
  setData = vi.fn();
}

class FakeMarker {
  el: HTMLElement;
  constructor(o?: { element?: HTMLElement }) {
    this.el = o?.element ?? document.createElement("div");
    markers.push(this);
  }
  setLngLat(): this {
    return this;
  }
  addTo(): this {
    return this;
  }
  getElement(): HTMLElement {
    return this.el;
  }
  remove(): void {}
}

class FakeMap {
  opts: Record<string, unknown>;
  handlers = new Map<string, (arg?: unknown) => void>();
  source = new FakeSource();
  addSource = vi.fn();
  addLayer = vi.fn();
  addControl = vi.fn();
  fitBounds = vi.fn();
  resize = vi.fn();
  remove = vi.fn();
  touchZoomRotate = { disableRotation: vi.fn() };
  constructor(opts: Record<string, unknown>) {
    this.opts = opts;
    created.push(this);
  }
  on(type: string, b: unknown, c?: unknown): this {
    const layer = typeof b === "function" ? "" : (b as string);
    const fn = (typeof b === "function" ? b : c) as (arg?: unknown) => void;
    this.handlers.set(`${type}:${layer}`, fn);
    return this;
  }
  getSource(): FakeSource {
    return this.source;
  }
  getCanvas(): { style: Record<string, string> } {
    return { style: {} };
  }
  emit(type: string, layer: string, arg?: unknown): void {
    this.handlers.get(`${type}:${layer}`)?.(arg);
  }
}

vi.mock("maplibre-gl", () => ({
  default: {
    Map: FakeMap,
    Marker: FakeMarker,
    NavigationControl: class {},
    addProtocol: vi.fn(),
  },
}));
vi.mock("pmtiles", () => ({
  Protocol: class {
    tile = vi.fn();
  },
}));

const { JourneyMap } = await import("@/components/JourneyMap");

function stop(overrides: Partial<JourneyStop> = {}): JourneyStop {
  return {
    ordinal: 1,
    place_id: "p",
    name: "Place",
    friendly_id: "place",
    latitude: 31.0,
    longitude: 35.0,
    confidence: "high",
    status: "identified",
    reference: "Acts 13:1",
    ...overrides,
  };
}

function renderMap(stops: JourneyStop[], onJump = vi.fn()) {
  render(<JourneyMap stops={stops} onJump={onJump} />);
  return { onJump };
}

/** Wait for the canvas, then fire the map's "load" event (adds the route source, sets ready). */
async function loadMap(): Promise<FakeMap> {
  await screen.findByTestId("journey-map-canvas");
  const map = created.at(-1)!;
  await act(async () => {
    map.emit("load", "");
  });
  return map;
}

beforeEach(() => {
  created.length = 0;
  markers.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("JourneyMap", () => {
  it("feeds the route source the filtered, ordinal-ordered located coords", async () => {
    const { onJump } = renderMap(
      [
        stop({ ordinal: 2, longitude: 36, latitude: 32 }),
        stop({ ordinal: 1, longitude: 35, latitude: 31 }),
        stop({ ordinal: 3, longitude: null, latitude: null }), // unlocated — never mapped
      ],
      vi.fn(),
    );
    void onJump;
    const map = await loadMap();

    // The route LineString carries only the located stops, in ordinal order.
    const lastCall = map.source.setData.mock.calls.at(-1)?.[0] as {
      geometry: { coordinates: unknown };
    };
    expect(lastCall.geometry.coordinates).toEqual([
      [35, 31],
      [36, 32],
    ]);
    // One marker per located stop (the unlocated stop has none).
    expect(markers).toHaveLength(2);
  });

  it("jumps to a stop's reference when its marker is clicked", async () => {
    const { onJump } = renderMap([
      stop({ ordinal: 1, longitude: 35, latitude: 31, reference: "Acts 13:1" }),
    ]);
    await loadMap();

    fireEvent.click(markers[0]!.getElement());
    expect(onJump).toHaveBeenCalledWith("Acts 13:1");
  });

  it("draws no markers for an all-unlocated journey", async () => {
    renderMap([
      stop({ ordinal: 1, longitude: null, latitude: null }),
      stop({ ordinal: 2, longitude: null, latitude: null }),
    ]);
    const map = await loadMap();

    const lastCall = map.source.setData.mock.calls.at(-1)?.[0] as {
      geometry: { coordinates: unknown };
    };
    expect(lastCall.geometry.coordinates).toEqual([]);
    expect(markers).toHaveLength(0);
  });
});
