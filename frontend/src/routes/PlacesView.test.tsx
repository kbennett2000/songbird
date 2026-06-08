import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PlacesView } from "@/routes/PlacesView";
import { server } from "@/test/msw/server";

function place(overrides: Record<string, unknown> = {}) {
  return {
    id: "a15257a",
    friendly_id: "Jerusalem",
    name: "Jerusalem",
    type: "settlement",
    latitude: 31.78,
    longitude: 35.23,
    confidence: "high",
    confidence_score: 90,
    status: "identified",
    ...overrides,
  };
}

function renderPlaces() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/places"]}>
        <PlacesView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PlacesView", () => {
  it("lists places with the honesty model per row (coords vs 'Location unknown')", async () => {
    server.use(
      http.get("/api/v1/places/browse", () =>
        HttpResponse.json({
          places: [
            place(),
            place({
              id: "a1ad8e1",
              name: "Land of Nod",
              type: "region",
              latitude: null,
              longitude: null,
              confidence: null,
              confidence_score: null,
              status: "unknown",
            }),
          ],
          total: 2,
        }),
      ),
    );
    renderPlaces();

    // Located place → coordinates; unknown place → honest "Location unknown" + its status badge.
    expect(await screen.findByText("Jerusalem")).toBeInTheDocument();
    expect(screen.getByText(/31\.78, 35\.23/)).toBeInTheDocument();
    expect(screen.getByText("Land of Nod")).toBeInTheDocument();
    expect(screen.getByText("Location unknown")).toBeInTheDocument();
    // The unknown place's status badge (scoped to its row, not the status-filter <option>).
    const nodRow = screen.getByText("Land of Nod").closest("li");
    expect(nodRow).not.toBeNull();
    expect(within(nodRow as HTMLElement).getByText("unknown")).toBeInTheDocument();
  });

  it("sends the status filter and the name query to the browse endpoint", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("/api/v1/places/browse", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ places: [place()], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderPlaces();

    await screen.findByText("Jerusalem");
    await user.selectOptions(screen.getByLabelText("Filter by status"), "identified");
    await user.type(screen.getByLabelText("Search places by name"), "jeru");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(seen?.get("status")).toBe("identified");
      expect(seen?.get("q")).toBe("jeru");
    });
  });

  it("pages with 'Load more' (offset)", async () => {
    server.use(
      http.get("/api/v1/places/browse", ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        if (offset === 0) {
          return HttpResponse.json({
            places: [place({ id: "p1", name: "Place One" }), place({ id: "p2", name: "Place Two" })],
            total: 3,
          });
        }
        return HttpResponse.json({ places: [place({ id: "p3", name: "Place Three" })], total: 3 });
      }),
    );
    const user = userEvent.setup();
    renderPlaces();

    expect(await screen.findByText("Place One")).toBeInTheDocument();
    expect(screen.queryByText("Place Three")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Place Three")).toBeInTheDocument();
  });

  it("shows a visible error on an outage (NOT swallowed — this is the screen's primary content)", async () => {
    server.use(
      http.get("/api/v1/places/browse", () => new HttpResponse(null, { status: 502 })),
    );
    renderPlaces();
    expect(await screen.findByText(/Couldn.t load places/)).toBeInTheDocument();
  });

  it("shows a plain empty state when no places match (not an error)", async () => {
    server.use(
      http.get("/api/v1/places/browse", () => HttpResponse.json({ places: [], total: 0 })),
    );
    renderPlaces();
    expect(await screen.findByText("No places match.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load/)).not.toBeInTheDocument();
  });

  it("shows the type filter only when Concord surfaces the vocabulary", async () => {
    server.use(
      http.get("/api/v1/places/browse", () => HttpResponse.json({ places: [place()], total: 1 })),
      http.get("/api/v1/place-types", () => HttpResponse.json(["settlement", "region"])),
    );
    renderPlaces();
    await screen.findByText("Jerusalem");
    expect(await screen.findByLabelText("Filter by type")).toBeInTheDocument();
  });

  it("hides the type filter when the vocabulary is empty (deferred, never hardcoded)", async () => {
    server.use(
      http.get("/api/v1/places/browse", () => HttpResponse.json({ places: [place()], total: 1 })),
      http.get("/api/v1/place-types", () => HttpResponse.json([])),
    );
    renderPlaces();
    await screen.findByText("Jerusalem");
    expect(screen.queryByLabelText("Filter by type")).not.toBeInTheDocument();
  });
});
