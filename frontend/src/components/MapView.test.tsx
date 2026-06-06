import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { MapView } from "@/components/MapView";
import { server } from "@/test/msw/server";

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

// Jerusalem & Rome are in-bounds; Tarshish (Iberia) is located but off the map; Eden is unknown.
const JERUSALEM = place({ id: "jeru", name: "Jerusalem", latitude: 31.78, longitude: 35.23 });
const ROME = place({ id: "rome", name: "Rome", latitude: 41.9, longitude: 12.5, confidence: "medium", status: "identified" });
const BABYLON = place({ id: "bab", name: "Babylon", latitude: 32.5, longitude: 44.4, confidence: "medium", status: "disputed" });
const TARSHISH = place({ id: "tar", name: "Tarshish", latitude: 36.7, longitude: -6.0, confidence: "low", status: "identified" });
const EDEN = place({ id: "eden", name: "Eden", latitude: null, longitude: null, confidence: null, confidence_score: null, status: "unknown" });

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

describe("MapView", () => {
  it("plots located, in-bounds places as pins", async () => {
    mockPlaces([JERUSALEM, ROME]);
    renderMap();
    const pins = await screen.findAllByTestId("map-pin");
    expect(pins).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Jerusalem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rome" })).toBeInTheDocument();
  });

  it("lists unknown places instead of plotting them", async () => {
    mockPlaces([JERUSALEM, EDEN]);
    renderMap();
    expect(await screen.findByText(/location unknown/i)).toHaveTextContent("Eden");
    expect(screen.queryByRole("button", { name: "Eden" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("map-pin")).toHaveLength(1);
  });

  it("lists located-but-off-extent places under 'Off this map'", async () => {
    mockPlaces([JERUSALEM, TARSHISH]);
    renderMap();
    expect(await screen.findByText(/off this map/i)).toHaveTextContent("Tarshish");
    expect(screen.queryByRole("button", { name: "Tarshish" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("map-pin")).toHaveLength(1);
  });

  it("encodes confidence visually: identified vs lower vs disputed differ", async () => {
    mockPlaces([JERUSALEM, ROME, BABYLON]);
    renderMap();
    await screen.findByRole("button", { name: "Jerusalem" });
    expect(screen.getByRole("button", { name: "Jerusalem" })).toHaveAttribute("data-tier", "solid");
    expect(screen.getByRole("button", { name: "Rome" })).toHaveAttribute("data-tier", "hollow");
    expect(screen.getByRole("button", { name: "Babylon" })).toHaveAttribute("data-tier", "disputed");
  });

  it("shows a card with name/status/confidence when a pin is tapped", async () => {
    mockPlaces([JERUSALEM]);
    const user = userEvent.setup();
    renderMap();
    await user.click(await screen.findByRole("button", { name: "Jerusalem" }));
    expect(screen.getByText("identified")).toBeInTheDocument();
    expect(screen.getByText(/high confidence/i)).toBeInTheDocument();
  });

  it("jumps to a verse from the card, reusing the existing navigation", async () => {
    mockPlaces([JERUSALEM]);
    server.use(
      http.get("/api/v1/places/:placeId/verses", () =>
        HttpResponse.json([{ book: "JHN", chapter: 3, verse: 16, reference: "John 3:16" }]),
      ),
    );
    const user = userEvent.setup();
    const { onJump } = renderMap();

    await user.click(await screen.findByRole("button", { name: "Jerusalem" }));
    const card = await screen.findByTestId("place-card");
    await user.click(await within(card).findByRole("button", { name: "John 3:16" }));
    expect(onJump).toHaveBeenCalledWith("JHN", 3, 16);
  });
});
