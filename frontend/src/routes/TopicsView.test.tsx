import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TopicsView } from "@/routes/TopicsView";
import { server } from "@/test/msw/server";

function topic(
  id: string,
  name: string,
  section: string,
  see_also: string | null = null,
  source?: string,
) {
  return { id, name, section, see_also, ...(source ? { source } : {}) };
}

// Made-up topical indexes and topics only: a study Bible's topic names are its own text.
const FIRST = "First Made-up Index";
const SECOND = "Second Made-up Index";

/** Two indexes, answering like Concord: one source or all, in Concord's own order (never
 * re-sorted here), with every index's count. Records each request's query. */
function twoSources(asked: URLSearchParams[] = []) {
  const all = [
    topic("made-up-a", "MADE-UP A", "M", null, FIRST),
    topic("made-up-c", "MADE-UP C", "M", null, FIRST),
    topic("mx-1", "Made-up b", "M", null, SECOND),
  ];
  server.use(
    http.get("/api/v1/topics", ({ request }) => {
      const params = new URL(request.url).searchParams;
      asked.push(params);
      const source = params.get("source");
      const topics = source ? all.filter((t) => t.source === source) : all;
      return HttpResponse.json({
        topics,
        total: topics.length,
        sources: [
          { source: FIRST, total: 2 },
          { source: SECOND, total: 1 },
        ],
      });
    }),
  );
  return asked;
}

const rowNames = () =>
  Array.from(document.querySelectorAll("main li a")).map((a) => a.textContent);

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

  it("offers a filter by index, with each one's count, when Concord has more than one", async () => {
    const asked = twoSources();
    const user = userEvent.setup();
    renderTopics();

    const from = await screen.findByRole("group", { name: "Topics from" });
    expect(within(from).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(
      ["All", `${FIRST} (2)`, `${SECOND} (1)`],
    );
    expect(within(from).getByRole("radio", { name: "All" })).toBeChecked();
    // Concord's order, as it came: no re-sorting by name or by index.
    expect(rowNames()).toEqual(["MADE-UP A", "MADE-UP C", "Made-up b"]);
    // Each row names its index.
    expect(screen.getByText(`M · ${SECOND}`)).toBeInTheDocument();
    expect(asked[0]!.has("source")).toBe(false);

    await user.click(within(from).getByRole("radio", { name: `${SECOND} (1)` }));
    await waitFor(() => expect(rowNames()).toEqual(["Made-up b"]));
    expect(asked.at(-1)!.get("source")).toBe(SECOND);
    expect(within(from).getByRole("radio", { name: `${SECOND} (1)` })).toBeChecked();

    await user.click(within(from).getByRole("radio", { name: "All" }));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
  });

  it("keeps the filter on screen while a new choice loads", async () => {
    let answer: () => void = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    server.use(
      http.get("/api/v1/topics", async ({ request }) => {
        const source = new URL(request.url).searchParams.get("source");
        if (source) await held; // the chosen index's page arrives only when the test says
        return HttpResponse.json({
          topics: [topic("made-up-a", "MADE-UP A", "M", null, FIRST)],
          total: 1,
          sources: [
            { source: FIRST, total: 1 },
            { source: SECOND, total: 0 },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    renderTopics();
    const from = await screen.findByRole("group", { name: "Topics from" });
    await user.click(within(from).getByRole("radio", { name: `${FIRST} (1)` }));
    expect(await screen.findByText("Loading topics…")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: `${FIRST} (1)` })).toBeChecked();
    answer();
    expect(await screen.findByRole("link", { name: "MADE-UP A" })).toBeInTheDocument();
  });

  it("names the chosen index when nothing in it matches", async () => {
    server.use(
      http.get("/api/v1/topics", ({ request }) => {
        const source = new URL(request.url).searchParams.get("source");
        return HttpResponse.json({
          topics: source ? [] : [topic("made-up-a", "MADE-UP A", "M", null, FIRST)],
          total: source ? 0 : 1,
          sources: [
            { source: FIRST, total: 1 },
            { source: SECOND, total: 0 },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    renderTopics();
    await user.click(await screen.findByRole("radio", { name: `${SECOND} (0)` }));
    expect(await screen.findByText(`No ${SECOND} topics match.`)).toBeInTheDocument();
  });

  it("shows no filter and no labels with one index, or from an older Concord", async () => {
    for (const page of [
      // One index: nothing to choose between.
      {
        topics: [topic("made-up-a", "MADE-UP A", "M", null, FIRST)],
        total: 1,
        sources: [{ source: FIRST, total: 1 }],
      },
      // An older Concord: no `source` on a topic and no `sources` at all.
      { topics: [topic("made-up-a", "MADE-UP A", "M")], total: 1 },
    ]) {
      const asked: URLSearchParams[] = [];
      server.use(
        http.get("/api/v1/topics", ({ request }) => {
          asked.push(new URL(request.url).searchParams);
          return HttpResponse.json(page);
        }),
      );
      const { unmount } = renderTopics();
      expect(await screen.findByRole("link", { name: "MADE-UP A" })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Topics from" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(screen.getByText("M").textContent).toBe("M");
      expect(asked.every((p) => !p.has("source"))).toBe(true);
      unmount();
    }
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
