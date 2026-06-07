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

  it("runs keyword Scripture search when toggled — no score, and jumps (issue #46)", async () => {
    let semanticCalled = false;
    server.use(
      http.get("/api/v1/semantic-search", () => {
        semanticCalled = true;
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          { book: "JHN", chapter: 11, verse: 35, reference: "John 11:35", text: "Jesus wept." },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "wept");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Exact match renders with its text, and NO score (keyword ≠ ranked).
    expect(await screen.findByText("John 11:35")).toBeInTheDocument();
    expect(screen.getByText("Jesus wept.")).toBeInTheDocument();
    expect(screen.queryByText(/score/)).not.toBeInTheDocument();
    // The heavy semantic endpoint is never hit in keyword mode.
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
});
