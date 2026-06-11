import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/msw/server";

// MapLibre needs WebGL, which happy-dom can't provide — so we mock it and assert the *wiring*
// (constructor options, sources/handlers, the click → PlaceCard path). Real rendering is covered
// by the Playwright e2e pass.
const created: FakeMap[] = [];
const markers: FakeMarker[] = [];

class FakeSource {
  setData = vi.fn();
  leaves: { properties: { id: string; name: string } }[] = [];
  // The zoom at which a cluster splits; > MAX_ZOOM (10) means it can never resolve (issue #118).
  expansionZoom = 6;
  getClusterLeaves = vi.fn(() => Promise.resolve(this.leaves));
  getClusterExpansionZoom = vi.fn(() => Promise.resolve(this.expansionZoom));
}

// A MapLibre HTML marker — records itself so tests can read the place-name labels / cluster badges
// the component creates (real rendering is the Playwright/manual gate; here we assert the wiring).
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
  remove(): void {
    const i = markers.indexOf(this);
    if (i >= 0) markers.splice(i, 1);
  }
}

class FakeMap {
  opts: Record<string, unknown>;
  handlers = new Map<string, (arg?: unknown) => void>();
  source = new FakeSource();
  // querySourceFeatures returns these, picked by filter: clusters vs unclustered points.
  clusterFeatures: unknown[] = [];
  pointFeatures: unknown[] = [];
  zoom = 6;
  getZoom = (): number => this.zoom;
  fitBounds = vi.fn();
  setFilter = vi.fn();
  addControl = vi.fn();
  easeTo = vi.fn();
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
  querySourceFeatures(_source: string, opts?: { filter?: unknown[] }): unknown[] {
    // The component queries clusters with ["has", "point_count"] and points with its negation.
    const filter = opts?.filter;
    const isPoints = Array.isArray(filter) && filter[0] === "!";
    return isPoints ? this.pointFeatures : this.clusterFeatures;
  }
  isSourceLoaded(): boolean {
    return true;
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
vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));

// Imported after the mocks are registered.
const { MapView } = await import("@/components/MapView");

function place(overrides: Record<string, unknown> = {}) {
  return {
    id: "x",
    friendly_id: "x",
    name: "Place",
    type: "settlement",
    latitude: 31.78,
    longitude: 35.23,
    confidence: "high",
    confidence_score: 90,
    status: "identified",
    ...overrides,
  };
}

const JERUSALEM = place({ id: "jeru", name: "Jerusalem" });
const BETHANY = place({ id: "beth", name: "Bethany", latitude: 31.9, longitude: 35.4 });
const TARSHISH = place({ id: "tar", name: "Tarshish", latitude: 36.7, longitude: -6.0 });
const EDEN = place({ id: "eden", name: "Eden", latitude: null, longitude: null, confidence_score: null, status: "unknown" });

function mockPlaces(places: ReturnType<typeof place>[]) {
  server.use(http.get("/api/v1/places", () => HttpResponse.json(places)));
}

function renderMap(onJump = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MapView book="JHN" chapter={3} onJump={onJump} />
    </QueryClientProvider>,
  );
  return { onJump };
}

/** Wait for the places query to resolve, then fire the map's "load" event (creates state). */
async function loadMap(): Promise<FakeMap> {
  await screen.findByTestId("map-canvas");
  const map = created.at(-1)!;
  await act(async () => {
    map.emit("load", "");
  });
  return map;
}

/** The DOM element of the first live marker with this test id (cluster badge / names / pin label). */
function markerByTestId(testid: string): HTMLElement | undefined {
  return markers.map((m) => m.getElement()).find((el) => el.dataset.testid === testid);
}

/** A cluster feature as MapLibre's querySourceFeatures returns it (one cluster, `count` members). */
function clusterFeature(count: number, id = 1) {
  return {
    geometry: { type: "Point", coordinates: [35.3, 31.85] },
    properties: { cluster_id: id, point_count: count },
  };
}

beforeEach(() => {
  created.length = 0;
  markers.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("MapView (MapLibre)", () => {
  it("constrains panning with maxBounds (can't scroll off the map)", async () => {
    mockPlaces([JERUSALEM]);
    renderMap();
    const map = await loadMap();
    expect(map.opts.maxBounds).toBeDefined();
  });

  it("surfaces a notice when the relief basemap fails to load (no silent blank)", async () => {
    mockPlaces([JERUSALEM]);
    renderMap();
    const map = await loadMap();
    // No notice while the basemap is fine.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // MapLibre fires `error` with the failing source id; the relief one shows a visible note.
    await act(async () => {
      map.emit("error", "", { sourceId: "relief", error: { message: "tile load failed" } });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/terrain/i);
  });

  it("frames the chapter's places on load (fitBounds)", async () => {
    mockPlaces([JERUSALEM]);
    renderMap();
    const map = await loadMap();
    await waitFor(() => expect(map.source.setData).toHaveBeenCalled());
    expect(map.fitBounds).toHaveBeenCalled();
  });

  it("lists unknown and off-map places instead of plotting them", async () => {
    mockPlaces([JERUSALEM, EDEN, TARSHISH]);
    renderMap();
    await loadMap();
    expect(await screen.findByText(/location unknown/i)).toHaveTextContent("Eden");
    expect(screen.getByText(/off this map/i)).toHaveTextContent("Tarshish");
  });

  it("opens a place card when a point is clicked, and jumps to a verse", async () => {
    mockPlaces([JERUSALEM]);
    server.use(
      http.get("/api/v1/places/:placeId/verses", () =>
        HttpResponse.json([{ book: "JHN", chapter: 3, verse: 16, reference: "John 3:16" }]),
      ),
    );
    const user = userEvent.setup();
    const { onJump } = renderMap();
    const map = await loadMap();

    await act(async () => {
      map.emit("click", "unclustered-point", {
        features: [{ geometry: { type: "Point", coordinates: [35.23, 31.78] }, properties: { id: "jeru" } }],
      });
    });
    const card = await screen.findByTestId("place-card");
    expect(card).toHaveTextContent("Jerusalem");
    await user.click(await within(card).findByRole("button", { name: "John 3:16" }));
    expect(onJump).toHaveBeenCalledWith("JHN", 3, 16);
  });

  it("labels each unclustered pin with its place name, toggled by the 'Aa' control (#86)", async () => {
    mockPlaces([JERUSALEM]);
    const user = userEvent.setup();
    renderMap();
    const map = await loadMap();

    // One unclustered point in view → its name label is created beside the pin, visible by default.
    map.pointFeatures = [
      {
        geometry: { type: "Point", coordinates: [35.23, 31.78] },
        properties: { id: "jeru", name: "Jerusalem" },
      },
    ];
    await act(async () => {
      map.emit("moveend", "");
    });
    const label = markers
      .map((m) => m.getElement())
      .find((el) => el.dataset.testid === "map-place-label");
    expect(label?.textContent).toBe("Jerusalem");
    expect(label?.style.display).toBe("");

    // The single "Aa" toggle hides the place names (along with the curated context labels).
    await user.click(screen.getByRole("button", { name: "Hide labels" }));
    expect(label?.style.display).toBe("none");
  });

  it("clicking a cluster lists its members and clears a stale place card", async () => {
    mockPlaces([JERUSALEM, BETHANY]);
    renderMap();
    const map = await loadMap();
    map.source.leaves = [
      { properties: { id: "jeru", name: "Jerusalem" } },
      { properties: { id: "beth", name: "Bethany" } },
    ];

    // Open a place card first.
    await act(async () => {
      map.emit("click", "unclustered-point", {
        features: [{ geometry: { type: "Point", coordinates: [35.23, 31.78] }, properties: { id: "jeru" } }],
      });
    });
    expect(await screen.findByTestId("place-card")).toBeInTheDocument();

    // Click the cluster: stale card clears, members are listed, and it zooms to expand.
    await act(async () => {
      map.emit("click", "clusters", {
        features: [{ geometry: { type: "Point", coordinates: [35.3, 31.85] }, properties: { cluster_id: 1 } }],
      });
    });
    const clusterCard = await screen.findByTestId("cluster-card");
    expect(within(clusterCard).getAllByTestId("cluster-member").map((m) => m.textContent)).toEqual([
      "Jerusalem",
      "Bethany",
    ]);
    expect(screen.queryByTestId("place-card")).not.toBeInTheDocument();
    expect(map.easeTo).toHaveBeenCalled();
  });

  it("reveals a never-resolving cluster's member names once zoomed in, replacing the count (#118)", async () => {
    mockPlaces([JERUSALEM, BETHANY]);
    renderMap();
    const map = await loadMap();
    map.zoom = 9; // past STUCK_LABEL_MIN_ZOOM
    map.source.expansionZoom = 15; // > MAX_ZOOM → these dots never separate
    map.source.leaves = [
      { properties: { id: "jeru", name: "Jerusalem" } },
      { properties: { id: "beth", name: "Bethany" } },
    ];
    map.clusterFeatures = [clusterFeature(2)];

    await act(async () => {
      map.emit("moveend", "");
    });

    // The async stuck-check swaps the count badge for the stacked member names.
    const names = await waitFor(() => {
      const el = markerByTestId("map-cluster-names");
      expect(el).toBeDefined();
      return el!;
    });
    expect([...names.children].map((c) => c.textContent)).toEqual(["Jerusalem", "Bethany"]);
    // The count badge is gone — the names stand in for it.
    expect(markerByTestId("map-cluster")).toBeUndefined();
  });

  it("keeps the count for a cluster that could still resolve by zooming (#118)", async () => {
    mockPlaces([JERUSALEM, BETHANY]);
    renderMap();
    const map = await loadMap();
    map.zoom = 9;
    map.source.expansionZoom = 6; // <= MAX_ZOOM → would still split if the user could zoom there
    map.clusterFeatures = [clusterFeature(2)];

    await act(async () => {
      map.emit("moveend", "");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(markerByTestId("map-cluster")?.textContent).toBe("2");
    expect(markerByTestId("map-cluster-names")).toBeUndefined();
  });

  it("doesn't reveal cluster names until zoomed in past the threshold (#118)", async () => {
    mockPlaces([JERUSALEM, BETHANY]);
    renderMap();
    const map = await loadMap();
    map.zoom = 6; // below STUCK_LABEL_MIN_ZOOM
    map.source.expansionZoom = 15;
    map.source.leaves = [
      { properties: { id: "jeru", name: "Jerusalem" } },
      { properties: { id: "beth", name: "Bethany" } },
    ];
    map.clusterFeatures = [clusterFeature(2)];

    await act(async () => {
      map.emit("moveend", "");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(markerByTestId("map-cluster")?.textContent).toBe("2");
    expect(markerByTestId("map-cluster-names")).toBeUndefined();
  });

  it("hiding labels (Aa) reverts a revealed cluster back to its count (#118)", async () => {
    mockPlaces([JERUSALEM, BETHANY]);
    const user = userEvent.setup();
    renderMap();
    const map = await loadMap();
    map.zoom = 9;
    map.source.expansionZoom = 15;
    map.source.leaves = [
      { properties: { id: "jeru", name: "Jerusalem" } },
      { properties: { id: "beth", name: "Bethany" } },
    ];
    map.clusterFeatures = [clusterFeature(2)];

    await act(async () => {
      map.emit("moveend", "");
    });
    await waitFor(() => expect(markerByTestId("map-cluster-names")).toBeDefined());

    // Hide labels: the names disappear and the count badge takes their place again.
    await user.click(screen.getByRole("button", { name: "Hide labels" }));
    await waitFor(() => {
      expect(markerByTestId("map-cluster-names")).toBeUndefined();
      expect(markerByTestId("map-cluster")?.textContent).toBe("2");
    });
  });
});
