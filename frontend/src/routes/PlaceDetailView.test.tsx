import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PlaceDetailView } from "@/routes/PlaceDetailView";
import { server } from "@/test/msw/server";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "a15257a",
    friendly_id: "Jerusalem",
    name: "Jerusalem",
    url_slug: "jerusalem",
    type: "settlement",
    preceding_article: null,
    latitude: 31.78,
    longitude: 35.23,
    confidence: "high",
    confidence_score: 90,
    status: "identified",
    modern_name: "Jerusalem, Israel",
    verse_count: 2,
    ...overrides,
  };
}

function renderDetail(id = "a15257a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Probe = () => <div>reader-at {useLocation().search}</div>;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/places/${id}`]}>
        <Routes>
          <Route path="/places/:id" element={<PlaceDetailView />} />
          <Route path="/read" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PlaceDetailView", () => {
  it("renders the honesty model + modern name + the verse list, and jumps to a verse", async () => {
    server.use(
      http.get("/api/v1/places/:placeId", () => HttpResponse.json(detail())),
      http.get("/api/v1/places/:placeId/verses", () =>
        HttpResponse.json([
          { book: "PSA", chapter: 122, verse: 6, reference: "Psalm 122:6" },
          { book: "MAT", chapter: 2, verse: 1, reference: "Matthew 2:1" },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Jerusalem" })).toBeInTheDocument();
    expect(screen.getByText(/Jerusalem, Israel/)).toBeInTheDocument();
    expect(screen.getByText(/31\.78, 35\.23/)).toBeInTheDocument(); // honesty: located coords
    expect(screen.getByText("Psalm 122:6")).toBeInTheDocument();

    // "Open in reader" jumps to the verse (verse-only, no translation switch).
    const [open] = screen.getAllByRole("link", { name: "Open in reader" });
    await user.click(open as HTMLElement);
    expect(await screen.findByText(/book=PSA&chapter=122&verse=6/)).toBeInTheDocument();
  });

  it("surfaces 'Location unknown' for an unlocated place (no fabricated pin)", async () => {
    server.use(
      http.get("/api/v1/places/:placeId", () =>
        HttpResponse.json(
          detail({ name: "Land of Nod", latitude: null, longitude: null, confidence: null, status: "unknown" }),
        ),
      ),
      http.get("/api/v1/places/:placeId/verses", () => HttpResponse.json([])),
    );
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Land of Nod" })).toBeInTheDocument();
    expect(screen.getByText("Location unknown")).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown place id (404)", async () => {
    server.use(
      http.get("/api/v1/places/:placeId", () =>
        HttpResponse.json({ detail: { code: "NOT_FOUND", message: "no place" } }, { status: 404 }),
      ),
    );
    renderDetail("zzz");
    expect(await screen.findByText(/doesn.t exist/)).toBeInTheDocument();
  });
});
