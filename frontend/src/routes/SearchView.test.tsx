import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SearchView } from "@/routes/SearchView";
import { server } from "@/test/msw/server";

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    book_usfm: "JHN",
    start_chapter: 14,
    start_verse: 27,
    end_chapter: 14,
    end_verse: 27,
    note_markdown: "on anxiety and peace",
    color: null,
    scope_type: "all",
    scope_translations: [] as string[],
    tags: ["peace"],
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Probe = () => <div>reader-at {useLocation().search}</div>;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/search"]}>
        <Routes>
          <Route path="/search" element={<SearchView />} />
          <Route path="/read" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SearchView", () => {
  it("shows ranked Scripture results with scores and keyword note results, and jumps", async () => {
    server.use(
      http.get("/api/v1/semantic-search", () =>
        HttpResponse.json([
          {
            book: "PRO",
            chapter: 12,
            verse: 25,
            reference: "Proverbs 12:25",
            score: 0.8952,
            text: "Heaviness in the heart of man maketh it stoop...",
          },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([note()])),
    );

    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Scripture (semantic) result with score.
    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    expect(screen.getByText(/score 0\.895/)).toBeInTheDocument();
    // Note (keyword) result.
    expect(screen.getByText(/on anxiety and peace/)).toBeInTheDocument();

    // Clicking a Scripture result jumps to the verse.
    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(await screen.findByText(/book=PRO&chapter=12&verse=25/)).toBeInTheDocument();
  });

  it("makes no query until the user searches", () => {
    renderSearch();
    expect(
      screen.getByText(/Enter a query to search Scripture/),
    ).toBeInTheDocument();
  });

  it("runs keyword search when toggled — highlights the match, no score, and jumps (#46/#49)", async () => {
    let semanticCalled = false;
    server.use(
      http.get("/api/v1/semantic-search", () => {
        semanticCalled = true;
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          {
            book: "JHN",
            chapter: 11,
            verse: 35,
            reference: "John 11:35",
            snippet: "Jesus <mark>wept</mark>.",
          },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "wept");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("John 11:35")).toBeInTheDocument();
    // The matched term renders inside a <mark>; the full snippet text is present (minus tags).
    const mark = screen.getByText("wept");
    expect(mark.tagName).toBe("MARK");
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Jesus wept."),
    ).toBeInTheDocument();
    // No score (keyword ≠ ranked), and the heavy semantic endpoint is never hit in keyword mode.
    expect(screen.queryByText(/score/)).not.toBeInTheDocument();
    expect(semanticCalled).toBe(false);

    // The result jumps into the reader at the verse.
    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(await screen.findByText(/book=JHN&chapter=11&verse=35/)).toBeInTheDocument();
  });

  it("does not run keyword search while in Semantic mode (issue #46)", async () => {
    let keywordCalled = false;
    server.use(
      http.get("/api/v1/semantic-search", () => HttpResponse.json([])),
      http.get("/api/v1/keyword-search", () => {
        keywordCalled = true;
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No matching verses.")).toBeInTheDocument();
    expect(keywordCalled).toBe(false);
  });

  it("offers the same search semantically when keyword finds nothing (issue #51)", async () => {
    server.use(
      // Keyword finds nothing (e.g. an FTS5-unrunnable query the backend now returns [] for);
      // semantic finds the verse.
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/semantic-search", () =>
        HttpResponse.json([
          {
            book: "1JN",
            chapter: 4,
            verse: 7,
            reference: "1 John 4:7",
            score: 0.9382,
            text: "Beloved, let us love one another...",
          },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "God's love");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // No error — a lack of results, plus a clickable offer to run the SAME query semantically.
    expect(await screen.findByText("No matching verses.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t search/)).not.toBeInTheDocument();
    const offer = screen.getByRole("button", { name: /Search “God's love” by meaning instead/ });

    await user.click(offer);

    // Switched to semantic for the same query → results appear; the toggle reflects the new mode.
    expect(await screen.findByText("1 John 4:7")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Semantic" })).toHaveAttribute("aria-selected", "true");
  });
});
