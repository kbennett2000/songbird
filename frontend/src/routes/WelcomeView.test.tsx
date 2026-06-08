import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    // Scope to the Recent notes section — the verse-of-the-day card also has an "Open" link.
    const recent = await screen.findByRole("region", { name: "Recent notes" });
    const opens = await within(recent).findAllByRole("link", { name: "Open" });
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

  it("shows a verse-of-the-day card in the reading translation, openable at the verse", async () => {
    let sentTranslation: string | null = null;
    server.use(
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({ user: profile({ last_translation: "WEB" }) }),
      ),
      http.get("/api/v1/random-verse", ({ request }) => {
        sentTranslation = new URL(request.url).searchParams.get("translation");
        return HttpResponse.json({
          translation: "WEB",
          book: "PSA",
          chapter: 23,
          verse: 1,
          reference: "Psalm 23:1",
          text: "Yahweh is my shepherd.",
        });
      }),
    );
    renderWelcome();

    const card = await screen.findByRole("region", { name: "Verse of the day" });
    expect(within(card).getByText("Yahweh is my shepherd.")).toBeInTheDocument();
    expect(within(card).getByText("Psalm 23:1")).toBeInTheDocument();
    // Display translation follows the profile (WEB), and "Open" is a verse-only jump.
    await waitFor(() => expect(sentTranslation).toBe("WEB"));
    expect(within(card).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/read?book=PSA&chapter=23&verse=1",
    );
  });

  it("re-rolls the verse on 'Show another'", async () => {
    let call = 0;
    server.use(
      http.get("/api/v1/random-verse", () => {
        call += 1;
        return HttpResponse.json(
          call === 1
            ? { translation: "KJV", book: "JHN", chapter: 11, verse: 35, reference: "John 11:35", text: "Jesus wept." }
            : { translation: "KJV", book: "PSA", chapter: 23, verse: 1, reference: "Psalm 23:1", text: "The LORD is my shepherd." },
        );
      }),
    );
    const user = userEvent.setup();
    renderWelcome();

    const card = await screen.findByRole("region", { name: "Verse of the day" });
    expect(within(card).getByText("John 11:35")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Show another" }));
    expect(await within(card).findByText("Psalm 23:1")).toBeInTheDocument();
    expect(within(card).queryByText("John 11:35")).not.toBeInTheDocument();
  });

  it("hides the card when the verse fetch fails, leaving the rest of Welcome intact", async () => {
    server.use(
      http.get("/api/v1/annotations", () => HttpResponse.json([note({ id: 1 })])),
      http.get("/api/v1/sermon-notes", () => HttpResponse.json([])),
      http.get("/api/v1/tags", () => HttpResponse.json(["grace"])),
      // Concord-down: the card must vanish without an error banner; the DB-sourced rest stays.
      http.get("/api/v1/random-verse", () => new HttpResponse(null, { status: 502 })),
    );
    renderWelcome();

    // The library stats (songbird's own DB) still render…
    expect(await screen.findByLabelText("Library")).toBeInTheDocument();
    // …and the verse-of-the-day card is simply absent — no banner.
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Verse of the day" })).not.toBeInTheDocument(),
    );
  });
});
