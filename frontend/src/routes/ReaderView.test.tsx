import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Stub the TipTap editor so the flow test doesn't depend on contenteditable/DOM internals.
vi.mock("@/components/NoteEditor", () => ({
  NoteEditor: ({
    initialMarkdown,
    onSave,
  }: {
    initialMarkdown: string;
    onSave: (markdown: string) => void;
  }) => (
    <div>
      <div data-testid="initial-markdown">{initialMarkdown}</div>
      <button type="button" onClick={() => onSave("My note")}>
        Save
      </button>
    </div>
  ),
}));

// MapLibre needs WebGL (unavailable in happy-dom). The map's own behavior is covered in
// MapView.test.tsx; here we only need the map modal to mount without crashing.
vi.mock("maplibre-gl", () => ({
  default: {
    Map: class {
      on() {
        return this;
      }
      addControl() {
        return this;
      }
      getSource() {
        return { setData() {} };
      }
      getCanvas() {
        return { style: {} as Record<string, string> };
      }
      querySourceFeatures() {
        return [];
      }
      isSourceLoaded() {
        return true;
      }
      fitBounds() {}
      setFilter() {}
      easeTo() {}
      resize() {}
      remove() {}
      touchZoomRotate = { disableRotation() {} };
    },
    Marker: class {
      setLngLat() {
        return this;
      }
      addTo() {
        return this;
      }
      getElement() {
        return document.createElement("div");
      }
      remove() {}
    },
    NavigationControl: class {},
    addProtocol() {},
  },
}));
vi.mock("pmtiles", () => ({ Protocol: class { tile() {} } }));

import { ReaderView } from "@/routes/ReaderView";
import { server } from "@/test/msw/server";

function annotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    book_usfm: "JHN",
    start_chapter: 3,
    start_verse: 16,
    end_chapter: 3,
    end_verse: 16,
    note_markdown: "My note",
    color: null,
    scope_type: "all",
    scope_translations: [] as string[],
    tags: [] as string[],
    in_scope: true,
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function readResponse(
  annotations: ReturnType<typeof annotation>[],
  translation = "KJV",
  sermonNotes: ReturnType<typeof sermonNote>[] = [],
) {
  return {
    translation,
    book: "JHN",
    chapter: 3,
    reference: "John 3",
    verses: [
      {
        book: "JHN",
        chapter: 3,
        verse: 16,
        reference: "John 3:16",
        text: `${translation} text 16`,
        annotations,
        sermon_notes: sermonNotes,
      },
    ],
  };
}

function sermonNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Devoted to the Apostles' Teaching",
    sermon_url: "https://youtu.be/abc123",
    reference: "John 3:16",
    book_usfm: "JHN",
    book_order_index: 43,
    start_chapter: 3,
    start_verse: 16,
    end_chapter: 3,
    end_verse: 16,
    event_date: "2026-01-05",
    tags: ["faith"] as string[],
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function renderReader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReaderView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReaderView", () => {
  it("renders the chapter's verses from Concord (via songbird)", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([], String(params.translation))),
      ),
    );
    renderReader();
    expect(await screen.findByText(/KJV text 16/)).toBeInTheDocument();
  });

  it("creates an annotation on a verse and shows the overlay marker", async () => {
    let created = false;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse(created ? [annotation()] : [])),
      ),
      http.post("/api/v1/annotations", () => {
        created = true;
        return HttpResponse.json(annotation(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    expect(await screen.findByText("Note on John 3:16")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "View note on verse 16" }),
    ).toBeInTheDocument();
  });

  it("switches translation, re-renders the chapter, and keeps the overlay", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([annotation()], String(params.translation))),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    expect(await screen.findByText(/KJV text 16/)).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Translation"), "WEB");
    // Re-renders in WEB, overlay still there.
    expect(await screen.findByText(/WEB text 16/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View note on verse 16" })).toBeInTheDocument();
  });

  it("opens to the profile's last-used translation and remembers a switch (issue #20)", async () => {
    const profile = (last_translation: string | null) => ({
      id: 1,
      username: "tester",
      is_admin: true,
      last_translation,
      last_book: null,
      last_chapter: null,
      created_at: "x",
    });
    let patched: string | null = null;
    server.use(
      http.get("/api/v1/auth/me", () => HttpResponse.json({ user: profile("WEB") })),
      http.patch("/api/v1/auth/me", async ({ request }) => {
        patched = ((await request.json()) as { last_translation?: string }).last_translation ?? null;
        return HttpResponse.json({ user: profile(patched) });
      }),
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([], String(params.translation))),
      ),
    );

    // Mirror production: RequireAuth has already loaded the user into cache before the reader mounts.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["auth", "me"], profile("WEB"));
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ReaderView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Opens in WEB (the profile's last-used), not the hardcoded KJV default.
    expect(await screen.findByText(/WEB text 16/)).toBeInTheDocument();

    // Switching persists the new choice back to the profile.
    await user.selectOptions(await screen.findByLabelText("Translation"), "KJV");
    expect(await screen.findByText(/KJV text 16/)).toBeInTheDocument();
    await waitFor(() => expect(patched).toBe("KJV"));
  });

  it("opens to the profile's last position — book + chapter + translation (issue #38)", async () => {
    const profile = {
      id: 1,
      username: "tester",
      is_admin: true,
      last_translation: "WEB",
      last_book: "ACT",
      last_chapter: 2,
      created_at: "x",
    };
    let patchCount = 0;
    server.use(
      http.get("/api/v1/auth/me", () => HttpResponse.json({ user: profile })),
      http.patch("/api/v1/auth/me", async ({ request }) => {
        patchCount += 1;
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ user: { ...profile, ...body } });
      }),
      // The default /read handler echoes the requested book/chapter into the verse text.
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json({
          translation: String(params.translation),
          book: String(params.book),
          chapter: Number(params.chapter),
          reference: `${String(params.book)} ${Number(params.chapter)}`,
          verses: [
            {
              book: String(params.book),
              chapter: Number(params.chapter),
              verse: 16,
              reference: `${String(params.book)} ${Number(params.chapter)}:16`,
              text: `${String(params.translation)} ${String(params.book)} ${Number(params.chapter)}`,
              annotations: [],
              sermon_notes: [],
            },
          ],
        }),
      ),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["auth", "me"], profile);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ReaderView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Reopens at Acts 2 in WEB — not the JHN 3 / KJV first-time defaults.
    expect(await screen.findByText(/WEB ACT 2/)).toBeInTheDocument();
    // No redundant write on mount: the reader is still sitting on the stored position.
    await waitFor(() => expect(patchCount).toBe(0));
  });

  it("persists the new full position when navigating chapters (issue #38)", async () => {
    let body: { last_translation?: string; last_book?: string; last_chapter?: number } | null = null;
    server.use(
      http.patch("/api/v1/auth/me", async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({
          user: {
            id: 1,
            username: "tester",
            is_admin: true,
            last_translation: body?.last_translation ?? null,
            last_book: body?.last_book ?? null,
            last_chapter: body?.last_chapter ?? null,
            created_at: "x",
          },
        });
      }),
    );

    const user = userEvent.setup();
    renderReader();
    // Defaults: JHN 3 in KJV (no seeded profile); the default /read handler echoes "JHN 3:16".
    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();

    // Next chapter → JHN 4; the whole position is saved (debounced).
    await user.click(screen.getByRole("button", { name: /next chapter/i }));
    expect(await screen.findByText(/JHN 4:16/)).toBeInTheDocument();
    await waitFor(() =>
      expect(body).toEqual({ last_translation: "KJV", last_book: "JHN", last_chapter: 4 }),
    );
  });

  it("self-heals a stale stored book that Concord no longer lists (issue #38)", async () => {
    const profile = {
      id: 1,
      username: "tester",
      is_admin: true,
      last_translation: "KJV",
      last_book: "ZZZ",
      last_chapter: 1,
      created_at: "x",
    };
    server.use(http.get("/api/v1/auth/me", () => HttpResponse.json({ user: profile })));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["auth", "me"], profile);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ReaderView />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // ZZZ isn't in Concord's book list → the reader falls back to John 3.
    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
  });

  it("overlays NET's translator's notes (separate from canonical annotations) and clears them on translation switch", async () => {
    const tnote = {
      book: "JHN",
      chapter: 3,
      verse: 16,
      reference: "John 3:16",
      type: "tn",
      text: "A translator's note ἀγάπη",
      char_offset: 19, // mirrors live NET John 3:16 (clamps to the synthetic verse's end)
      marker: "7",
      ordinal: 0, // live ordinals are 0-based
      cross_references: [
        {
          to_book: "ROM",
          to_chapter: 5,
          to_verse_start: 8,
          to_verse_end: null,
          reference: "Romans 5:8",
        },
      ],
    };
    server.use(
      // A canonical annotation is present in every translation (separate system).
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([annotation()], String(params.translation))),
      ),
      // Notes exist only for WEB here (standing in for NET); other translations → empty.
      http.get("/api/v1/notes/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(String(params.translation) === "WEB" ? [tnote] : []),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    // KJV (default): the canonical annotation overlay shows, but NO note marker.
    expect(await screen.findByRole("button", { name: "View note on verse 16" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Translator's note 1" })).not.toBeInTheDocument();

    // Switch to WEB → the note marker appears; the annotation overlay is untouched.
    await user.selectOptions(await screen.findByLabelText("Translation"), "WEB");
    const marker = await screen.findByRole("button", { name: "Translator's note 1" });
    expect(screen.getByRole("button", { name: "View note on verse 16" })).toBeInTheDocument();

    // Tapping the marker reveals the note (Greek intact) and its canonical cross-ref.
    await user.click(marker);
    expect(await screen.findByText(/A translator's note ἀγάπη/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Romans 5:8/ })).toBeInTheDocument();

    // Switch away → markers clear (notes are NET's), annotation overlay remains.
    await user.selectOptions(screen.getByLabelText("Translation"), "KJV");
    expect(
      await screen.findByRole("button", { name: "View note on verse 16" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Translator's note 1" })).not.toBeInTheDocument();
  });

  it("shows all three overlays on one verse without collision, and opens the sermon popover", async () => {
    const tnote = {
      book: "JHN",
      chapter: 3,
      verse: 16,
      reference: "John 3:16",
      type: "tn",
      text: "A translator's note",
      char_offset: 4,
      marker: "1",
      ordinal: 0,
      cross_references: [],
    };
    server.use(
      // A canonical annotation (amber ●) + a sermon note (emerald ▶) on verse 16…
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(
          readResponse([annotation()], String(params.translation), [sermonNote()]),
        ),
      ),
      // …plus a slice-11 translator note (violet inline marker) for NET.
      http.get("/api/v1/notes/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(String(params.translation) === "WEB" ? [tnote] : []),
      ),
    );
    const user = userEvent.setup();
    renderReader();
    // Wait for the chapter (and the translations dropdown) to load before switching to NET/WEB.
    await screen.findByRole("button", { name: "Sermon on verse 16" });
    await user.selectOptions(await screen.findByLabelText("Translation"), "WEB");

    // The three systems coexist as distinct affordances on the same verse.
    expect(await screen.findByRole("button", { name: "View note on verse 16" })).toBeInTheDocument(); // amber ●
    expect(screen.getByRole("button", { name: "Translator's note 1" })).toBeInTheDocument(); // violet superscript
    const sermonMarker = screen.getByRole("button", { name: "Sermon on verse 16" }); // emerald ▶
    expect(sermonMarker).toBeInTheDocument();

    // The sermon marker opens its own popover with the external link.
    await user.click(sermonMarker);
    expect(await screen.findByText("Devoted to the Apostles' Teaching")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Watch the sermon/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("keeps the sermon marker across a translation switch (all-translations, no scope)", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([], String(params.translation), [sermonNote()])),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    // Present in the default translation…
    expect(await screen.findByRole("button", { name: "Sermon on verse 16" })).toBeInTheDocument();
    // …and still present after switching (sermon notes are not translation-specific).
    await user.selectOptions(await screen.findByLabelText("Translation"), "WEB");
    expect(await screen.findByText(/WEB text 16/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sermon on verse 16" })).toBeInTheDocument();
  });

  it("counts multiple sermons on a verse and lists ALL of them (none hidden behind [0])", async () => {
    const sermons = [
      sermonNote({ id: 1, title: "First Sermon" }),
      sermonNote({ id: 2, title: "Second Sermon" }),
      sermonNote({ id: 3, title: "Third Sermon" }),
      sermonNote({ id: 4, title: "Fourth Sermon" }),
    ];
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([], String(params.translation), sermons)),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    // Counted ▶ (not the single-sermon label), and the count is visible.
    const marker = await screen.findByRole("button", { name: "4 sermons on verse 16" });
    expect(marker).toHaveTextContent("4");
    expect(screen.queryByRole("button", { name: "Sermon on verse 16" })).not.toBeInTheDocument();

    // Tapping lists every sermon — all four reachable, none hidden.
    await user.click(marker);
    expect(await screen.findByText("Sermons · 4")).toBeInTheDocument();
    for (const title of ["First Sermon", "Second Sermon", "Third Sermon", "Fourth Sermon"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("opens the single-sermon popover (unchanged) for a verse with exactly one sermon", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(readResponse([], String(params.translation), [sermonNote()])),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    const marker = await screen.findByRole("button", { name: "Sermon on verse 16" });
    await user.click(marker);
    // The single-note popover header ("Sermon"), not the list header ("Sermons · n").
    expect(await screen.findByText("Devoted to the Apostles' Teaching")).toBeInTheDocument();
    expect(screen.queryByText(/Sermons ·/)).not.toBeInTheDocument();
  });

  it("keeps three overlays distinct on one verse even with multiple sermons (counted ▶)", async () => {
    const tnote = {
      book: "JHN",
      chapter: 3,
      verse: 16,
      reference: "John 3:16",
      type: "tn",
      text: "A translator's note",
      char_offset: 4,
      marker: "1",
      ordinal: 0,
      cross_references: [],
    };
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(
          readResponse([annotation()], String(params.translation), [
            sermonNote({ id: 1, title: "Sermon A" }),
            sermonNote({ id: 2, title: "Sermon B" }),
          ]),
        ),
      ),
      http.get("/api/v1/notes/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(String(params.translation) === "WEB" ? [tnote] : []),
      ),
    );
    const user = userEvent.setup();
    renderReader();
    await screen.findByRole("button", { name: "2 sermons on verse 16" });
    await user.selectOptions(await screen.findByLabelText("Translation"), "WEB");

    // All three systems coexist; the sermon affordance is the counted ▶.
    expect(await screen.findByRole("button", { name: "View note on verse 16" })).toBeInTheDocument(); // amber ●
    expect(screen.getByRole("button", { name: "Translator's note 1" })).toBeInTheDocument(); // violet superscript
    expect(screen.getByRole("button", { name: "2 sermons on verse 16" })).toBeInTheDocument(); // emerald counted ▶
  });

  it("keeps the counted ▶ across a translation switch", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) =>
        HttpResponse.json(
          readResponse([], String(params.translation), [
            sermonNote({ id: 1 }),
            sermonNote({ id: 2 }),
          ]),
        ),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    expect(await screen.findByRole("button", { name: "2 sermons on verse 16" })).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Translation"), "WEB");
    expect(await screen.findByText(/WEB text 16/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 sermons on verse 16" })).toBeInTheDocument();
  });

  it("sends the chosen scope when creating an annotation", async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([])),
      ),
      http.post("/api/v1/annotations", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(annotation({ scope_type: "current", scope_translations: ["KJV"] }), {
          status: 201,
        });
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    await user.click(await screen.findByRole("radio", { name: /This translation only/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: "Annotate verse 16" }); // panel closed → back to reader
    expect(captured).toMatchObject({ scope_type: "current", translations: ["KJV"] });
  });

  it("renders an out-of-scope annotation as a gray marker with a panel label", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(
          readResponse(
            [annotation({ scope_type: "current", scope_translations: ["KJV"], in_scope: false })],
            "WEB",
          ),
        ),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    // Out-of-scope → gray marker, not the amber "View note" one.
    const grayMarker = await screen.findByRole("button", {
      name: "View out-of-scope note on verse 16",
    });
    expect(screen.queryByRole("button", { name: "View note on verse 16" })).not.toBeInTheDocument();

    await user.click(grayMarker);
    expect(await screen.findByText(/written for KJV/)).toBeInTheDocument();
  });

  it("jumps to a reference (resolved by Concord) and navigates", async () => {
    server.use(
      http.get("/api/v1/resolve", () =>
        HttpResponse.json({ reference: "Acts 1", book: "ACT", chapter: 1, verse: null }),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Jump to reference"), "Acts 1");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByText(/ACT 1:16/)).toBeInTheDocument();
  });

  it("shows a not-found message for an unparseable reference", async () => {
    server.use(
      http.get("/api/v1/resolve", () =>
        HttpResponse.json({ detail: { code: "NOT_FOUND", message: "nope" } }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    await user.type(await screen.findByLabelText("Jump to reference"), "asdfqwer");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByText(/Couldn't find that reference/)).toBeInTheDocument();
  });

  it("navigates with next and previous chapter", async () => {
    const user = userEvent.setup();
    renderReader();

    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(await screen.findByText(/JHN 4:16/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous chapter" }));
    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
  });

  it("keeps the annotation overlay after navigating", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) => {
        const book = String(params.book);
        const chapter = Number(params.chapter);
        return HttpResponse.json({
          translation: "KJV",
          book,
          chapter,
          reference: `${book} ${chapter}`,
          verses: [
            {
              book,
              chapter,
              verse: 16,
              reference: `${book} ${chapter}:16`,
              text: `${book} ${chapter}:16 — text`,
              annotations: [annotation()],
              sermon_notes: [],
            },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    renderReader();

    expect(
      await screen.findByRole("button", { name: "View note on verse 16" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(await screen.findByText(/JHN 4:16/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View note on verse 16" })).toBeInTheDocument();
  });

  it("shows cross-references for a verse and jumps to one", async () => {
    server.use(
      http.get("/api/v1/cross-references/:book/:chapter/:verse", () =>
        HttpResponse.json([
          {
            book: "ROM",
            chapter: 5,
            verse_start: 8,
            verse_end: null,
            reference: "Romans 5:8",
            votes: 968,
            text: "But God commendeth his love...",
          },
        ]),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    await screen.findByText(/JHN 3:16/);
    await user.click(screen.getByRole("button", { name: "Cross-references for verse 16" }));
    // The cross-ref renders (sourced from Concord) with its snippet.
    expect(await screen.findByText("Romans 5:8")).toBeInTheDocument();
    expect(screen.getByText(/But God commendeth/)).toBeInTheDocument();

    // Clicking it jumps the reader to that verse (reusing navigation).
    await user.click(screen.getByText("Romans 5:8"));
    expect(await screen.findByText(/ROM 5:16/)).toBeInTheDocument();
  });

  it("shows places with the honesty model and jumps to a place's verse", async () => {
    server.use(
      http.get("/api/v1/places", () =>
        HttpResponse.json([
          {
            id: "a15257a",
            friendly_id: "Jerusalem",
            name: "Jerusalem",
            type: "settlement",
            latitude: 31.78,
            longitude: 35.23,
            confidence: "high",
            confidence_score: 90,
            status: "identified",
          },
          {
            id: "a1ad8e1",
            friendly_id: "Nod",
            name: "Land of Nod",
            type: "region",
            latitude: null,
            longitude: null,
            confidence: null,
            confidence_score: null,
            status: "unknown",
          },
        ]),
      ),
      http.get("/api/v1/places/:placeId/verses", () =>
        HttpResponse.json([{ book: "GEN", chapter: 2, verse: 8, reference: "Genesis 2:8" }]),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    await screen.findByText(/JHN 3:16/);
    await user.click(screen.getByRole("button", { name: "Places in this chapter" }));

    // Identified place shows its coordinates; the unknown place is honestly unlocated.
    expect(await screen.findByText("Jerusalem")).toBeInTheDocument();
    expect(screen.getByText(/31\.78, 35\.23/)).toBeInTheDocument();
    expect(screen.getByText("Land of Nod")).toBeInTheDocument();
    expect(screen.getByText("Location unknown")).toBeInTheDocument();

    // Expand a place → its verses → click one → reader jumps there.
    await user.click(screen.getByRole("button", { name: /Jerusalem/ }));
    await user.click(await screen.findByRole("button", { name: "Genesis 2:8" }));
    expect(await screen.findByText(/GEN 2:16/)).toBeInTheDocument();
  });

  it("disables the globe when the chapter has no mappable places", async () => {
    server.use(
      http.get("/api/v1/places", () =>
        HttpResponse.json([
          {
            id: "a1ad8e1",
            friendly_id: "Nod",
            name: "Land of Nod",
            type: "region",
            latitude: null,
            longitude: null,
            confidence: null,
            confidence_score: null,
            status: "unknown",
          },
        ]),
      ),
    );
    renderReader();
    await screen.findByText(/JHN 3:16/);
    expect(await screen.findByRole("button", { name: "Show map" })).toBeDisabled();
    // …but the chapter DOES name a place (just unlocated), so the Places panel stays available.
    expect(screen.getByRole("button", { name: "Places in this chapter" })).toBeEnabled();
  });

  it("disables 'Places in this chapter' when the chapter names no places (#55)", async () => {
    // Default /api/v1/places handler returns [] → an empty panel would be pointless.
    renderReader();
    await screen.findByText(/JHN 3:16/);
    expect(
      await screen.findByRole("button", { name: "Places in this chapter" }),
    ).toBeDisabled();
  });

  it("enables the globe and opens the map modal when there's a located place", async () => {
    server.use(
      http.get("/api/v1/places", () =>
        HttpResponse.json([
          {
            id: "a15257a",
            friendly_id: "Jerusalem",
            name: "Jerusalem",
            type: "settlement",
            latitude: 31.78,
            longitude: 35.23,
            confidence: "high",
            confidence_score: 90,
            status: "identified",
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderReader();
    await screen.findByText(/JHN 3:16/);

    const globe = await screen.findByRole("button", { name: "Show map" });
    expect(globe).toBeEnabled();
    await user.click(globe);

    expect(await screen.findByRole("dialog", { name: "Map — JHN 3" })).toBeInTheDocument();
    // Pins are now GL-rendered (not DOM nodes); assert the map canvas mounted instead.
    expect(await screen.findByTestId("map-canvas")).toBeInTheDocument();
  });

  it("defaults the note-type toggle to Standard (the annotation editor)", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([])),
      ),
    );
    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    // Standard is the selected tab; the annotation editor (stubbed) is what's shown.
    expect(screen.getByRole("tab", { name: "Standard" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sermon" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("initial-markdown")).toBeInTheDocument();
  });

  it("creates a sermon note via the type toggle and shows its marker", async () => {
    let captured: Record<string, unknown> | null = null;
    let created = false;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([], "KJV", created ? [sermonNote()] : [])),
      ),
      http.post("/api/v1/sermon-notes", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        created = true;
        return HttpResponse.json(sermonNote(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    await user.click(screen.getByRole("tab", { name: "Sermon" }));

    // The reference is prefilled from the clicked verse.
    expect(screen.getByLabelText("Reference")).toHaveValue("John 3:16");
    await user.type(screen.getByLabelText("Title"), "A New Sermon");
    await user.type(screen.getByLabelText("Sermon URL"), "https://example.test/x");
    await user.type(screen.getByLabelText("Add a tag"), "grace");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The client sends only the human reference + tags; the server resolves the canonical anchor
    // and span from it (#91), so no coordinate fields go on the wire.
    expect(await screen.findByRole("button", { name: "Sermon on verse 16" })).toBeInTheDocument();
    expect(captured).toMatchObject({
      title: "A New Sermon",
      sermon_url: "https://example.test/x",
      reference: "John 3:16",
      tags: ["grace"],
    });
    for (const coord of [
      "book_usfm",
      "book_order_index",
      "start_chapter",
      "start_verse",
      "end_chapter",
      "end_verse",
    ]) {
      expect(captured).not.toHaveProperty(coord);
    }
  });

  it("can author a sermon note over a verse range via the reference", async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([], "KJV", [])),
      ),
      http.post("/api/v1/sermon-notes", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sermonNote(), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    await user.click(screen.getByRole("tab", { name: "Sermon" }));

    const reference = screen.getByLabelText("Reference");
    await user.clear(reference);
    await user.type(reference, "Joshua 6:1-16");
    await user.type(screen.getByLabelText("Title"), "Jericho");
    await user.type(screen.getByLabelText("Sermon URL"), "https://example.test/j");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The range reference is forwarded verbatim — the server expands it into the covering span.
    await vi.waitFor(() => expect(captured).not.toBeNull());
    expect(captured).toMatchObject({ reference: "Joshua 6:1-16" });
  });

  it("surfaces an error when the sermon reference can't be resolved", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([], "KJV", [])),
      ),
      http.post("/api/v1/sermon-notes", () =>
        HttpResponse.json({ detail: { code: "NOT_FOUND", message: "no" } }, { status: 404 }),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    await user.click(screen.getByRole("tab", { name: "Sermon" }));
    await user.type(screen.getByLabelText("Title"), "Bad ref");
    await user.type(screen.getByLabelText("Sermon URL"), "https://example.test/x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Couldn't find that reference/)).toBeInTheDocument();
  });

  it("edits a sermon note from its popover", async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([], "KJV", [sermonNote({ title: "Old Title" })])),
      ),
      http.patch("/api/v1/sermon-notes/:id", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(sermonNote({ title: "New Title" }));
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Sermon on verse 16" }));
    await user.click(await screen.findByRole("button", { name: /Edit sermon/ }));

    // The edit panel is prefilled; change the title and save → PATCH.
    const title = screen.getByLabelText("Title");
    expect(title).toHaveValue("Old Title");
    await user.clear(title);
    await user.type(title, "New Title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: "Sermon on verse 16" }); // panel closed → back to reader
    expect(captured).toMatchObject({ title: "New Title", reference: "John 3:16" });
  });

  it("deletes a sermon note from its popover", async () => {
    let deletedId: string | null = null;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([], "KJV", [sermonNote({ id: 7 })])),
      ),
      http.delete("/api/v1/sermon-notes/:id", ({ params }) => {
        deletedId = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Sermon on verse 16" }));
    await user.click(await screen.findByRole("button", { name: /Delete sermon/ }));

    await vi.waitFor(() => expect(deletedId).toBe("7"));
  });

  it("includes tags when saving an annotation", async () => {
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([])),
      ),
      http.post("/api/v1/annotations", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(annotation({ tags: ["grace"] }), { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "Annotate verse 16" }));
    await user.type(screen.getByLabelText("Add a tag"), "grace");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: "Annotate verse 16" });
    expect(captured).toMatchObject({ tags: ["grace"] });
  });

  it("surfaces the notes notice only on a genuine Concord outage (502)", async () => {
    server.use(
      http.get("/api/v1/notes/:translation/:book/:chapter", () =>
        HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE", message: "down" } }, {
          status: 502,
        }),
      ),
    );
    renderReader();

    // The chapter still renders (the notes call is non-blocking)…
    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
    // …and the outage surfaces the notice.
    expect(await screen.findByText(/Translator.*notes unavailable/)).toBeInTheDocument();
  });

  it("treats a 404 from the notes route as 'no notes' — no notice (Concord v1.1.0 pin)", async () => {
    server.use(
      http.get("/api/v1/notes/:translation/:book/:chapter", () =>
        HttpResponse.json({ detail: { code: "NOT_FOUND", message: "no notes here" } }, {
          status: 404,
        }),
      ),
    );
    renderReader();

    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
    // A 404 means genuinely-not-found, not an outage — markers simply absent, no scary message.
    expect(screen.queryByText(/Translator.*notes unavailable/)).not.toBeInTheDocument();
  });

  it("shows no notice when the notes route returns an empty 200 (stock no-notes image)", async () => {
    server.use(
      http.get("/api/v1/notes/:translation/:book/:chapter", () => HttpResponse.json([])),
    );
    renderReader();

    expect(await screen.findByText(/JHN 3:16/)).toBeInTheDocument();
    expect(screen.queryByText(/Translator.*notes unavailable/)).not.toBeInTheDocument();
  });
});
