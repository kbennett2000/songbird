import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { JourneysView } from "@/routes/JourneysView";
import { server } from "@/test/msw/server";

function journey(id: string, name: string, dating: string | null = "AD 46–48") {
  return { id, name, scripture: "Acts 13–14", dating, stop_count: 5 };
}

function renderJourneys() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/journeys"]}>
        <JourneysView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("JourneysView", () => {
  it("lists journeys (name, scripture, dating, stop_count) linking each to its detail", async () => {
    server.use(
      http.get("/api/v1/journeys", () =>
        HttpResponse.json({ journeys: [journey("paul-1", "Paul's First Journey")], total: 1 }),
      ),
    );
    renderJourneys();

    const link = await screen.findByRole("link", { name: "Paul's First Journey" });
    expect(link).toHaveAttribute("href", "/journeys/paul-1");
    expect(screen.getByText(/Acts 13–14/)).toBeInTheDocument();
    expect(screen.getByText(/AD 46–48/)).toBeInTheDocument();
    expect(screen.getByText(/5 stops/)).toBeInTheDocument();
  });

  it("pages with 'Load more' (offset) and appends, driven by total", async () => {
    server.use(
      http.get("/api/v1/journeys", ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        return HttpResponse.json({
          journeys: [journey(`j${offset}`, `Journey ${offset}`)],
          total: 2,
        });
      }),
    );
    const user = userEvent.setup();
    renderJourneys();

    expect(await screen.findByText("Journey 0")).toBeInTheDocument();
    // total (2) > loaded (1) → Load more is offered; clicking fetches offset 1 and appends.
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Journey 1")).toBeInTheDocument();
    expect(screen.getByText("Journey 0")).toBeInTheDocument();
  });

  it("surfaces an error (does not stay silent) when the list fails", async () => {
    server.use(
      http.get("/api/v1/journeys", () =>
        HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE" } }, { status: 502 }),
      ),
    );
    renderJourneys();
    expect(
      await screen.findByText(/Couldn.t load journeys \(is Concord reachable/),
    ).toBeInTheDocument();
  });
});
