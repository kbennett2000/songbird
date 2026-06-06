import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

function readResponse(annotations: ReturnType<typeof annotation>[], translation = "KJV") {
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
      },
    ],
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
    expect(await screen.findByRole("button", { name: "Jerusalem" })).toBeInTheDocument();
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
});
