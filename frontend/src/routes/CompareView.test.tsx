import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CompareView } from "@/routes/CompareView";
import { server } from "@/test/msw/server";

function ann(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    book_usfm: "JHN",
    start_chapter: 3,
    start_verse: 16,
    end_chapter: 3,
    end_verse: 16,
    note_markdown: "For God so loved",
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

type VerseSpec = { verse: number; annotations?: ReturnType<typeof ann>[] };

function chapterFor(translation: string, verses: VerseSpec[]) {
  return {
    translation,
    book: "JHN",
    chapter: 3,
    reference: "John 3",
    verses: verses.map(({ verse, annotations = [] }) => ({
      book: "JHN",
      chapter: 3,
      verse,
      reference: `John 3:${verse}`,
      text: `${translation} 3:${verse}`,
      annotations,
      sermon_notes: [] as never[],
    })),
  };
}

/** Override the read endpoint with a per-translation builder (defaults to a plain verse 16). */
function useRead(perTranslation: (t: string) => VerseSpec[]) {
  server.use(
    http.get("/api/v1/read/:translation/:book/:chapter", ({ params }) => {
      const t = String(params.translation);
      return HttpResponse.json(chapterFor(t, perTranslation(t)));
    }),
  );
}

function useTranslations(...codes: string[]) {
  server.use(
    http.get("/api/v1/translations", () =>
      HttpResponse.json({
        translations: codes.map((id) => ({
          id,
          name: id,
          language: "en",
          versification: "standard",
          attribution: null,
        })),
      }),
    ),
  );
}

function renderCompare() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompareView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CompareView", () => {
  it("aligns the same canonical verse across two translation columns (invariant 4)", async () => {
    // A note anchored to JHN 3:16 is in scope for every translation, so it sits on the SAME row in
    // both columns — the canonical-coordinate bridge made visible.
    useRead(() => [{ verse: 15 }, { verse: 16, annotations: [ann()] }, { verse: 17 }]);
    renderCompare();

    expect(await screen.findByText("KJV 3:16")).toBeInTheDocument();
    expect(await screen.findByText("WEB 3:16")).toBeInTheDocument();
    // The annotation overlay shows on verse 16 in BOTH columns — aligned by address, not text.
    expect(screen.getByRole("button", { name: "View note on KJV 16" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View note on WEB 16" })).toBeInTheDocument();
  });

  it("marks a translation-scoped note in-scope in its column and out-of-scope in the others", async () => {
    // A note written for KJV only: the server resolves `in_scope` per translation.
    useRead((t) => [
      {
        verse: 16,
        annotations: [ann({ scope_type: "current", scope_translations: ["KJV"], in_scope: t === "KJV" })],
      },
    ]);
    renderCompare();

    expect(await screen.findByText("KJV 3:16")).toBeInTheDocument();
    // KJV column: in-scope filled marker; WEB column: out-of-scope hollow marker. Await the WEB
    // marker — its column resolves on its own query, which may settle after KJV's.
    expect(screen.getByRole("button", { name: "View note on KJV 16" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "View out-of-scope note on WEB 16" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View note on WEB 16" })).not.toBeInTheDocument();
  });

  it("opens a read-only popover with the note and a deep-link back to the reader", async () => {
    useRead(() => [{ verse: 16, annotations: [ann({ note_markdown: "grace abounds" })] }]);
    const user = userEvent.setup();
    renderCompare();

    await user.click(await screen.findByRole("button", { name: "View note on KJV 16" }));
    expect(await screen.findByText("grace abounds")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open in reader/ });
    expect(link).toHaveAttribute("href", "/read?book=JHN&chapter=3&verse=16");
  });

  it("switches a column's translation and refetches just that column", async () => {
    useTranslations("KJV", "WEB", "ASV");
    useRead(() => [{ verse: 16 }]);
    const user = userEvent.setup();
    renderCompare();

    expect(await screen.findByText("KJV 3:16")).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Translation column 1"), "ASV");
    expect(await screen.findByText("ASV 3:16")).toBeInTheDocument();
    // The other column (WEB) is untouched; the replaced KJV is gone.
    expect(await screen.findByText("WEB 3:16")).toBeInTheDocument();
    expect(screen.queryByText("KJV 3:16")).not.toBeInTheDocument();
  });

  it("adds and removes columns within the 1–3 bound", async () => {
    useTranslations("KJV", "WEB", "ASV");
    useRead(() => [{ verse: 16 }]);
    const user = userEvent.setup();
    renderCompare();

    // Opens with two columns (seeded distinct); a third can still be added.
    expect(await screen.findByLabelText("Translation column 2")).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Add translation"), "ASV");

    // Third column appears and, at the max, the add control disappears.
    expect(await screen.findByLabelText("Translation column 3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add translation")).not.toBeInTheDocument();

    // Removing one drops back to two columns and the add control returns.
    await user.click(screen.getByRole("button", { name: "Remove column 3" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Translation column 3")).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Add translation")).toBeInTheDocument();
  });

  it("renders an em-dash where a translation lacks a verse the other has", async () => {
    // KJV has verse 15; WEB does not. The WEB cell for verse 15 is an honest gap, not a guess.
    useRead((t) => (t === "KJV" ? [{ verse: 15 }, { verse: 16 }] : [{ verse: 16 }]));
    renderCompare();

    expect(await screen.findByText("KJV 3:15")).toBeInTheDocument();
    expect(await screen.findByText("WEB 3:16")).toBeInTheDocument();
    // The missing WEB 3:15 cell shows an em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});
