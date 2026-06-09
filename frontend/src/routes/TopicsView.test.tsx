import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TopicsView } from "@/routes/TopicsView";
import { server } from "@/test/msw/server";

function topic(id: string, name: string, section: string, see_also: string | null = null) {
  return { id, name, section, see_also };
}

function renderTopics() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/topics"]}>
        <TopicsView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TopicsView", () => {
  it("lists topics (name + section) and links each to its detail route", async () => {
    server.use(
      http.get("/api/v1/topics", () =>
        HttpResponse.json({ topics: [topic("love", "Love", "God")], total: 1 }),
      ),
    );
    renderTopics();

    const link = await screen.findByRole("link", { name: "Love" });
    expect(link).toHaveAttribute("href", "/topics/love");
    expect(screen.getByText("God")).toBeInTheDocument();
  });

  it("sends the search term (q) and section filter to the request", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("/api/v1/topics", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({ topics: [topic("love", "Love", "God")], total: 1 });
      }),
    );
    const user = userEvent.setup();
    renderTopics();

    await user.type(screen.getByLabelText("Search topics by name"), "lov");
    await user.type(screen.getByLabelText("Filter by section"), "God");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(seen?.get("q")).toBe("lov");
      expect(seen?.get("section")).toBe("God");
    });
  });

  it("pages with 'Load more' (offset) and appends, driven by total", async () => {
    server.use(
      http.get("/api/v1/topics", ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
        return HttpResponse.json({
          topics: [topic(`t${offset}`, `Topic ${offset}`, "God")],
          total: 2,
        });
      }),
    );
    const user = userEvent.setup();
    renderTopics();

    expect(await screen.findByText("Topic 0")).toBeInTheDocument();
    // total (2) > loaded (1) → Load more is offered; clicking fetches offset 1 and appends.
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Topic 1")).toBeInTheDocument();
    expect(screen.getByText("Topic 0")).toBeInTheDocument();
  });

  it("surfaces an error (does not stay silent) when the browse fails", async () => {
    server.use(
      http.get("/api/v1/topics", () =>
        HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE" } }, { status: 502 }),
      ),
    );
    renderTopics();
    expect(
      await screen.findByText(/Couldn.t load topics \(is Concord reachable/),
    ).toBeInTheDocument();
  });
});
