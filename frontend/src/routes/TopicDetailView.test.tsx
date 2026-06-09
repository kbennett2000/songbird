import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TopicDetailView } from "@/routes/TopicDetailView";
import { server } from "@/test/msw/server";

function detail(overrides: Record<string, unknown> = {}) {
  return { id: "love", name: "Love", section: "God", see_also: null, verse_count: 2, ...overrides };
}

function topicVerse(book: string, chapter: number, verse: number, text: string | null = null) {
  return { book, chapter, verse, reference: `${book} ${chapter}:${verse}`, text };
}

function renderDetail(id = "love") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Probe = () => <div>reader-at {useLocation().search}</div>;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/topics/${id}`]}>
        <Routes>
          <Route path="/topics/:id" element={<TopicDetailView />} />
          <Route path="/read" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TopicDetailView", () => {
  it("renders the header (name, section, verse_count) and its verses", async () => {
    server.use(
      http.get("/api/v1/topics/:id", () => HttpResponse.json(detail())),
      http.get("/api/v1/topics/:id/verses", () =>
        HttpResponse.json([topicVerse("ROM", 5, 8, "But God commends his love…")]),
      ),
    );
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Love" })).toBeInTheDocument();
    expect(screen.getByText("God")).toBeInTheDocument();
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument(); // verse_count
    expect(await screen.findByText("ROM 5:8")).toBeInTheDocument();
    expect(screen.getByText(/But God commends/)).toBeInTheDocument();
  });

  it("jumps to the reader when a verse row is clicked", async () => {
    server.use(
      http.get("/api/v1/topics/:id", () => HttpResponse.json(detail())),
      http.get("/api/v1/topics/:id/verses", () => HttpResponse.json([topicVerse("ROM", 5, 8)])),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByText("ROM 5:8"));
    expect(await screen.findByText(/reader-at/)).toHaveTextContent("book=ROM");
    expect(screen.getByText(/reader-at/)).toHaveTextContent("chapter=5");
    expect(screen.getByText(/reader-at/)).toHaveTextContent("verse=8");
  });

  it("renders a see_also redirect linking to the target topic (no verse list)", async () => {
    server.use(
      http.get("/api/v1/topics/:id", () =>
        HttpResponse.json(detail({ id: "charity", name: "Charity", see_also: "love" })),
      ),
    );
    renderDetail("charity");

    const link = await screen.findByRole("link", { name: /See love/ });
    expect(link).toHaveAttribute("href", "/topics/love");
    // A redirect carries no verses — the Verses section isn't rendered.
    expect(screen.queryByRole("heading", { name: /Verses/ })).not.toBeInTheDocument();
  });

  it("shows a not-found message for an unknown topic (404)", async () => {
    server.use(
      http.get("/api/v1/topics/:id", () =>
        HttpResponse.json({ detail: { code: "NOT_FOUND" } }, { status: 404 }),
      ),
    );
    renderDetail("nope");
    expect(await screen.findByText(/That topic doesn.t exist/)).toBeInTheDocument();
  });
});
