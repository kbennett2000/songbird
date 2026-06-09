import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/test/msw/server";

// The route map is covered in JourneyMap.test (and needs WebGL); here we stub it so the detail
// view's metadata / note callout / stop list / jump can be asserted without driving MapLibre.
vi.mock("@/components/JourneyMap", () => ({
  JourneyMap: () => <div data-testid="journey-map" />,
}));

const { JourneyDetailView } = await import("@/routes/JourneyDetailView");

function stop(overrides: Record<string, unknown> = {}) {
  return {
    ordinal: 1,
    place_id: "antioch",
    name: "Antioch",
    friendly_id: "antioch-syria",
    latitude: 36.2,
    longitude: 36.16,
    confidence: "high",
    status: "identified",
    reference: "Acts 13:1",
    ...overrides,
  };
}

function journey(overrides: Record<string, unknown> = {}) {
  return {
    id: "paul-1",
    name: "Paul's First Missionary Journey",
    scripture: "Acts 13–14",
    dating: "AD 46–48",
    source: "Curated from Acts",
    note: "Sea crossings are drawn as direct lines; the precise route is not asserted.",
    stops: [
      stop(),
      stop({
        ordinal: 2,
        place_id: "unknown-port",
        name: "An unnamed port",
        friendly_id: null,
        latitude: null,
        longitude: null,
        confidence: null,
        status: null,
        reference: null,
      }),
    ],
    ...overrides,
  };
}

function renderDetail(id = "paul-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Probe = () => <div>reader-at {useLocation().search}</div>;
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/journeys/${id}`]}>
        <Routes>
          <Route path="/journeys/:id" element={<JourneyDetailView />} />
          <Route path="/read" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JourneyDetailView", () => {
  it("renders metadata, the note callout, and the ordered stop list (located and unlocated)", async () => {
    server.use(http.get("/api/v1/journeys/:id", () => HttpResponse.json(journey())));
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: /Paul's First Missionary Journey/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Acts 13–14/)).toBeInTheDocument();
    // The one-reconstruction note is a prominent callout (the honesty check).
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/Sea crossings are drawn as direct lines/);
    // Both stops appear; the unlocated one is listed (not mapped) with "Location unknown".
    expect(screen.getByText("Antioch")).toBeInTheDocument();
    expect(screen.getByText("An unnamed port")).toBeInTheDocument();
    expect(screen.getByText(/Location unknown/)).toBeInTheDocument();
    // Confidence/status render for the located stop.
    expect(screen.getByText("identified")).toBeInTheDocument();
    expect(screen.getByText(/high confidence/)).toBeInTheDocument();
  });

  it("jumps a stop's reference to the reader (resolve → navigate)", async () => {
    server.use(
      http.get("/api/v1/journeys/:id", () => HttpResponse.json(journey())),
      http.get("/api/v1/resolve", () =>
        HttpResponse.json({ reference: "Acts 13:1", book: "ACT", chapter: 13, verse: 1 }),
      ),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Acts 13:1" }));
    const probe = await screen.findByText(/reader-at/);
    expect(probe).toHaveTextContent("book=ACT");
    expect(probe).toHaveTextContent("chapter=13");
    expect(probe).toHaveTextContent("verse=1");
  });

  it("tolerates a null dating and a null-reference stop (no jump button)", async () => {
    server.use(
      http.get("/api/v1/journeys/:id", () =>
        HttpResponse.json(
          journey({
            dating: null,
            stops: [stop({ reference: null })],
          }),
        ),
      ),
    );
    renderDetail();

    expect(await screen.findByText("Antioch")).toBeInTheDocument();
    // No reference → no jump button for that stop.
    expect(screen.queryByRole("button", { name: "Acts 13:1" })).not.toBeInTheDocument();
  });

  it("shows a not-found message for an unknown journey (404)", async () => {
    server.use(
      http.get("/api/v1/journeys/:id", () =>
        HttpResponse.json({ detail: { code: "NOT_FOUND" } }, { status: 404 }),
      ),
    );
    renderDetail("nope");
    expect(await screen.findByText(/That journey doesn.t exist/)).toBeInTheDocument();
  });

  it("surfaces an inline error on a non-404 failure", async () => {
    server.use(
      http.get("/api/v1/journeys/:id", () =>
        HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE" } }, { status: 502 }),
      ),
    );
    renderDetail();
    expect(await screen.findByText(/Couldn.t load this journey/)).toBeInTheDocument();
  });
});
