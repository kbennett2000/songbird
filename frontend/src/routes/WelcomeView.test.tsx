import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { WelcomeView } from "@/routes/WelcomeView";
import { server } from "@/test/msw/server";

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    book_usfm: "JHN",
    start_chapter: 3,
    start_verse: 16,
    end_chapter: 3,
    end_verse: 16,
    note_markdown: "grace note",
    color: null,
    scope_type: "all",
    scope_translations: [] as string[],
    tags: [] as string[],
    author_id: 1,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function sermon(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "The Prodigal Son",
    sermon_url: "https://youtu.be/abc",
    reference: "Luke 15:11",
    book_usfm: "LUK",
    book_order_index: 42,
    start_chapter: 15,
    start_verse: 11,
    end_chapter: 15,
    end_verse: 11,
    event_date: null,
    tags: [] as string[],
    author_id: 1,
    created_at: "2026-06-02T00:00:00Z",
    updated_at: "2026-06-02T00:00:00Z",
    ...overrides,
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "kris",
    is_admin: true,
    last_translation: null,
    last_book: null,
    last_chapter: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWelcome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WelcomeView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WelcomeView", () => {
  it("shows branding, an empty-library state, and quick links", async () => {
    server.use(
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/sermon-notes", () => HttpResponse.json([])),
      http.get("/api/v1/tags", () => HttpResponse.json([])),
    );
    renderWelcome();

    expect(await screen.findByText(/Annotate Scripture/)).toBeInTheDocument();
    // First-time user (no saved position) → "Start reading", linking into the reader.
    const cta = await screen.findByRole("link", { name: /Start reading/ });
    expect(cta).toHaveAttribute("href", "/read");
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();
    // Quick-link cards.
    expect(screen.getByRole("link", { name: /Browse notes/ })).toHaveAttribute("href", "/browse");
    expect(screen.getByRole("link", { name: /Search/ })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: /Compare/ })).toHaveAttribute("href", "/compare");
  });

  it("labels 'continue reading' with the saved position", async () => {
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({
          user: profile({ last_book: "JHN", last_chapter: 3, last_translation: "KJV" }),
        }),
      ),
    );
    renderWelcome();

    // Book name resolved from the books list ("John"), with the saved chapter + translation.
    const cta = await screen.findByRole("link", { name: /Continue in John 3 · KJV/ });
    expect(cta).toHaveAttribute("href", "/read");
  });

  it("lists recent notes newest-first and links each into the reader", async () => {
    const older = note({ id: 1, note_markdown: "older", updated_at: "2026-06-01T00:00:00Z" });
    const newer = note({
      id: 2,
      book_usfm: "ROM",
      start_chapter: 5,
      start_verse: 8,
      end_chapter: 5,
      end_verse: 8,
      note_markdown: "newer",
      updated_at: "2026-06-03T00:00:00Z",
    });
    const mid = sermon({ updated_at: "2026-06-02T00:00:00Z" });
    server.use(
      http.get("/api/v1/annotations", () => HttpResponse.json([older, newer])),
      http.get("/api/v1/sermon-notes", () => HttpResponse.json([mid])),
      http.get("/api/v1/tags", () => HttpResponse.json(["grace"])),
    );
    renderWelcome();

    const opens = await screen.findAllByRole("link", { name: "Open" });
    // Sorted by updated_at desc: newer note (06-03) → sermon (06-02) → older note (06-01).
    expect(opens.map((a) => a.getAttribute("href"))).toEqual([
      "/read?book=ROM&chapter=5&verse=8",
      "/read?book=LUK&chapter=15&verse=11",
      "/read?book=JHN&chapter=3&verse=16",
    ]);
  });

  it("shows library stats", async () => {
    server.use(
      http.get("/api/v1/annotations", () => HttpResponse.json([note({ id: 1 }), note({ id: 2 })])),
      http.get("/api/v1/sermon-notes", () => HttpResponse.json([sermon()])),
      http.get("/api/v1/tags", () => HttpResponse.json(["grace", "faith", "hope"])),
    );
    renderWelcome();

    // Counts render once their queries resolve (Notes 2 · Sermon notes 1 · Tags 3).
    expect(await screen.findByText("2")).toBeInTheDocument();
    const stats = screen.getByLabelText("Library");
    expect(stats).toHaveTextContent("2");
    expect(stats).toHaveTextContent("1");
    expect(stats).toHaveTextContent("3");
  });
});
