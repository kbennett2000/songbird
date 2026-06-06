import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
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
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

function readResponse(annotations: ReturnType<typeof annotation>[]) {
  return {
    translation: "KJV",
    book: "JHN",
    chapter: 3,
    reference: "John 3",
    verses: [
      {
        book: "JHN",
        chapter: 3,
        verse: 16,
        reference: "John 3:16",
        text: "For God so loved the world...",
        annotations,
      },
    ],
  };
}

function renderReader() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReaderView />
    </QueryClientProvider>,
  );
}

describe("ReaderView", () => {
  it("renders the chapter's verses from Concord (via songbird)", async () => {
    renderReader();
    expect(await screen.findByText(/For God so loved the world/)).toBeInTheDocument();
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
    // Overlay re-renders from the (now non-empty) read response.
    expect(
      await screen.findByRole("button", { name: "View note on verse 16" }),
    ).toBeInTheDocument();
  });

  it("opens an existing note prefilled with its Markdown", async () => {
    server.use(
      http.get("/api/v1/read/:translation/:book/:chapter", () =>
        HttpResponse.json(readResponse([annotation({ id: 7, note_markdown: "existing **note**" })])),
      ),
    );

    const user = userEvent.setup();
    renderReader();

    await user.click(await screen.findByRole("button", { name: "View note on verse 16" }));
    expect(await screen.findByTestId("initial-markdown")).toHaveTextContent("existing **note**");
  });
});
