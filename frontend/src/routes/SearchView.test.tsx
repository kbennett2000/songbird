import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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

/** A study-notes search page as the API sends it: these hits, out of `total` in all. */
function notesPage<T>(results: T[], total = results.length) {
  return { results, total };
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
  it("semantic mode shows ranked Scripture only (no keyword note results) and jumps (#67)", async () => {
    let notesCalled = false;
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
      http.get("/api/v1/annotations", () => {
        notesCalled = true;
        return HttpResponse.json([note()]);
      }),
    );

    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Scripture (semantic) result with score.
    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    expect(screen.getByText(/score 0\.895/)).toBeInTheDocument();
    // No keyword note results in semantic mode — the note search never even fires (#67).
    expect(screen.queryByText(/on anxiety and peace/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Note results" })).not.toBeInTheDocument();
    expect(notesCalled).toBe(false);

    // Clicking a Scripture result jumps to the verse.
    await user.click(screen.getByRole("link", { name: "Open" }));
    expect(await screen.findByText(/book=PRO&chapter=12&verse=25/)).toBeInTheDocument();
  });

  it("keyword mode shows keyword Scripture and keyword note results together", async () => {
    server.use(
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          {
            book: "PRO",
            chapter: 12,
            verse: 25,
            reference: "Proverbs 12:25",
            snippet: "Heaviness in the heart of man maketh it stoop.",
          },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([note()])),
    );

    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Both the keyword Scripture hit and the keyword note hit render.
    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    expect(screen.getByText(/on anxiety and peace/)).toBeInTheDocument();
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

  it("keyword search defaults to ALL translations (no translations param sent)", async () => {
    let sentTranslations: string | null = "unset";
    server.use(
      http.get("/api/v1/keyword-search", ({ request }) => {
        sentTranslations = new URL(request.url).searchParams.get("translations");
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    // The scope control defaults to "All translations".
    expect(screen.getByRole("button", { name: /Translations:/ })).toHaveTextContent(
      "All translations",
    );
    await user.type(screen.getByLabelText("Search query"), "wept");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("No matching verses.");
    // "All" → the param is omitted entirely (backend defaults to all).
    expect(sentTranslations).toBeNull();
  });

  it("narrowing the picker to one translation sends translations=WEB", async () => {
    let sentTranslations: string | null = null;
    server.use(
      http.get("/api/v1/keyword-search", ({ request }) => {
        sentTranslations = new URL(request.url).searchParams.get("translations");
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.click(screen.getByRole("button", { name: /Translations:/ }));
    await user.click(await screen.findByRole("checkbox", { name: "WEB" }));
    await user.type(screen.getByLabelText("Search query"), "wept");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("No matching verses.");
    expect(sentTranslations).toBe("WEB");
  });

  it("renders a multi-translation hit with a labeled, highlighted snippet per match, reading-translation first", async () => {
    server.use(
      // The verse matched in two translations. WEB is listed first in the payload to prove the UI
      // hoists the reading translation (KJV, the default) to the top regardless of payload order.
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          {
            book: "JHN",
            chapter: 11,
            verse: 35,
            reference: "John 11:35",
            snippet: "WEB Jesus <mark>wept</mark>.",
            matches: {
              WEB: "WEB Jesus <mark>wept</mark>.",
              KJV: "KJV Jesus <mark>wept</mark>.",
            },
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
    // Both translations' snippets render, each highlighted (two <mark>s) and id-labeled.
    expect(screen.getAllByText("wept").every((m) => m.tagName === "MARK")).toBe(true);
    expect(screen.getAllByText("wept")).toHaveLength(2);
    const kjvBadge = screen.getByText("KJV");
    const webBadge = screen.getByText("WEB");
    // Reading translation (KJV) leads, even though WEB came first in the payload.
    expect(kjvBadge.compareDocumentPosition(webBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("semantic search now displays in the reading translation, not hardcoded KJV (behavior change)", async () => {
    let sentTranslation: string | null = null;
    server.use(
      // Profile's reading translation is WEB.
      http.get("/api/v1/auth/me", () =>
        HttpResponse.json({
          user: {
            id: 1,
            username: "tester",
            is_admin: true,
            last_translation: "WEB",
            last_book: null,
            last_chapter: null,
            created_at: "2026-01-01T00:00:00Z",
          },
        }),
      ),
      http.get("/api/v1/semantic-search", ({ request }) => {
        sentTranslation = new URL(request.url).searchParams.get("translation");
        return HttpResponse.json([
          { book: "PSA", chapter: 23, verse: 1, reference: "Psalm 23:1", score: 0.9, text: "…" },
        ]);
      }),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText("Search query"), "shepherd");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Psalm 23:1")).toBeInTheDocument();
    // The display translation follows the profile (WEB), not the old hardcoded KJV.
    await waitFor(() => expect(sentTranslation).toBe("WEB"));
  });

  it("hides the Study notes section when Concord has no matching notes (the stock case)", async () => {
    server.use(
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          { book: "PRO", chapter: 12, verse: 25, reference: "Proverbs 12:25", snippet: "…" },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () => HttpResponse.json(notesPage([]))),
    );
    const user = userEvent.setup();
    renderSearch();

    // Study notes search runs in keyword mode; with an empty result the section stays absent.
    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Scripture renders; the Study-notes results section is simply absent (no header, no "no
    // notes" line). ("Study notes" as text still exists — it's the scope checkbox label now.)
    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Study notes results" })).not.toBeInTheDocument();
  });

  it("shows the Study notes section on hits — type badge, highlight, and verse jump", async () => {
    server.use(
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () =>
        HttpResponse.json(notesPage([
          {
            book: "JHN",
            chapter: 3,
            verse: 16,
            reference: "John 3:16",
            translation: "NET",
            type: "sn",
            snippet: "The word for <mark>love</mark> is agape.",
          },
        ])),
      ),
    );
    const user = userEvent.setup();
    renderSearch();

    // Study notes are keyword-matched, so they only search in keyword mode (#66/#67).
    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "love");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // The section shows with the reader's "sn" label and a highlighted snippet.
    expect(await screen.findByRole("region", { name: "Study notes results" })).toBeInTheDocument();
    expect(screen.getByText("Study note")).toBeInTheDocument();
    const mark = screen.getByText("love");
    expect(mark.tagName).toBe("MARK");

    // "Open in reader" jumps to the verse (no translation switch in the link).
    await user.click(screen.getByRole("link", { name: "Open in reader" }));
    expect(await screen.findByText(/book=JHN&chapter=3&verse=16/)).toBeInTheDocument();
  });

  it("falls back to a neutral 'Note' badge for an unknown note type", async () => {
    server.use(
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () =>
        HttpResponse.json(notesPage([
          {
            book: "GEN",
            chapter: 1,
            verse: 1,
            reference: "Genesis 1:1",
            translation: "NET",
            type: "weird",
            snippet: "A <mark>note</mark>.",
          },
        ])),
      ),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "note");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Genesis 1:1")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument(); // neutral fallback, never the raw "weird"
    expect(screen.queryByText("weird")).not.toBeInTheDocument();
  });

  it("an outage shows the Study notes section's own error, and the rest of the page stays intact", async () => {
    server.use(
      // Study notes search runs in keyword mode; a keyword Scripture hit anchors the page.
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          { book: "PRO", chapter: 12, verse: 25, reference: "Proverbs 12:25", snippet: "…" },
        ]),
      ),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () =>
        HttpResponse.json(
          { detail: { code: "CONCORD_UNREACHABLE", message: "Concord is unreachable" } },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Scripture still renders; the Study notes section says what went wrong, never "no matches"
    // (invariant 3).
    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    const section = await screen.findByRole("region", { name: "Study notes results" });
    expect(
      await within(section).findByText("Couldn’t search the study notes (is Concord reachable?)."),
    ).toBeInTheDocument();
    expect(within(section).queryByText(/match/)).not.toBeInTheDocument();
  });

  it("unchecking Scripture excludes it from the search (scope, #62)", async () => {
    let scriptureCalled = false;
    server.use(
      http.get("/api/v1/semantic-search", () => {
        scriptureCalled = true;
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/keyword-search", () => {
        scriptureCalled = true;
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/annotations", () => HttpResponse.json([note()])),
      http.get("/api/v1/study-notes-search", () => HttpResponse.json(notesPage([]))),
    );
    const user = userEvent.setup();
    renderSearch();

    // The scope row lives in keyword mode now (#66); switch there to reach the checkboxes.
    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.click(screen.getByRole("checkbox", { name: "Scripture" })); // uncheck
    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Your notes still renders; the Scripture section and its request are gone.
    expect(await screen.findByText(/on anxiety and peace/)).toBeInTheDocument();
    expect(scriptureCalled).toBe(false);
    expect(screen.queryByRole("region", { name: "Scripture results" })).not.toBeInTheDocument();
  });

  it("unchecking Your notes excludes it from the search (scope, #62)", async () => {
    let notesCalled = false;
    server.use(
      http.get("/api/v1/keyword-search", () =>
        HttpResponse.json([
          { book: "PRO", chapter: 12, verse: 25, reference: "Proverbs 12:25", snippet: "…" },
        ]),
      ),
      http.get("/api/v1/annotations", () => {
        notesCalled = true;
        return HttpResponse.json([note()]);
      }),
      http.get("/api/v1/study-notes-search", () => HttpResponse.json(notesPage([]))),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.click(screen.getByRole("checkbox", { name: "Your notes" })); // uncheck
    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    expect(notesCalled).toBe(false);
    expect(screen.queryByRole("region", { name: "Note results" })).not.toBeInTheDocument();
  });

  it("unchecking Study notes excludes it even when it would have hits (scope, #62)", async () => {
    let studyCalled = false;
    server.use(
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () => {
        studyCalled = true;
        return HttpResponse.json(notesPage([
          { book: "JHN", chapter: 3, verse: 16, reference: "John 3:16", translation: "NET", type: "sn", snippet: "love" },
        ]));
      }),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.click(screen.getByRole("checkbox", { name: "Study notes" })); // uncheck
    await user.type(screen.getByLabelText("Search query"), "love");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Scripture settles (no matches); the study-notes request never fired despite the hit above.
    expect(await screen.findByText("No matching verses.")).toBeInTheDocument();
    expect(studyCalled).toBe(false);
    expect(screen.queryByRole("region", { name: "Study notes results" })).not.toBeInTheDocument();
  });

  it("shows a hint and searches nothing when all scopes are unchecked (#62)", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    for (const name of ["Scripture", "Your notes", "Study notes"]) {
      await user.click(screen.getByRole("checkbox", { name }));
    }
    await user.type(screen.getByLabelText("Search query"), "anything");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Pick what to search above.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Scripture results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Note results" })).not.toBeInTheDocument();
  });

  it("hides the scope row in Semantic mode and shows it in Keyword mode (#66)", async () => {
    const user = userEvent.setup();
    renderSearch();

    // Default Semantic mode: no scope checkboxes — they only apply to keyword searches.
    expect(screen.queryByRole("checkbox", { name: "Scripture" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Your notes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Study notes" })).not.toBeInTheDocument();

    // Switching to Keyword reveals the row.
    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    expect(screen.getByRole("checkbox", { name: "Scripture" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Your notes" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Study notes" })).toBeInTheDocument();

    // ...and switching back hides it again.
    await user.click(screen.getByRole("tab", { name: "Semantic" }));
    expect(screen.queryByRole("checkbox", { name: "Your notes" })).not.toBeInTheDocument();
  });

  it("a semantic search fires no keyword, note, or study-note requests (#67)", async () => {
    let keywordCalled = false;
    let notesCalled = false;
    let studyCalled = false;
    server.use(
      http.get("/api/v1/semantic-search", () =>
        HttpResponse.json([
          { book: "PRO", chapter: 12, verse: 25, reference: "Proverbs 12:25", score: 0.8, text: "…" },
        ]),
      ),
      http.get("/api/v1/keyword-search", () => {
        keywordCalled = true;
        return HttpResponse.json([]);
      }),
      http.get("/api/v1/annotations", () => {
        notesCalled = true;
        return HttpResponse.json([note()]);
      }),
      http.get("/api/v1/study-notes-search", () => {
        studyCalled = true;
        return HttpResponse.json(notesPage([
          { book: "JHN", chapter: 3, verse: 16, reference: "John 3:16", translation: "NET", type: "sn", snippet: "x" },
        ]));
      }),
    );
    const user = userEvent.setup();
    renderSearch();

    await user.type(screen.getByLabelText("Search query"), "anxiety");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Only the semantic Scripture section renders; no keyword-derived results or requests.
    expect(await screen.findByText("Proverbs 12:25")).toBeInTheDocument();
    expect(keywordCalled).toBe(false);
    expect(notesCalled).toBe(false);
    expect(studyCalled).toBe(false);
    expect(screen.queryByRole("region", { name: "Note results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Study notes results" })).not.toBeInTheDocument();
  });

  // --- Concord v8: a study Bible's notes beside NET's. Made-up text only. ---

  function translationsWithNotes(counts: Record<string, number | undefined>) {
    return http.get("/api/v1/translations", () =>
      HttpResponse.json({
        translations: Object.entries(counts).map(([id, note_count]) => ({
          id,
          name: id,
          language: "en",
          versification: "standard",
          attribution: null,
          note_count,
        })),
      }),
    );
  }

  const EMB_HIT = {
    book: "GEN",
    chapter: 12,
    verse: 10,
    reference: "Genesis 12:10",
    translation: "EMB",
    type: "sn",
    snippet: "A *made-up* note on <mark>famine</mark>, see [the next chapter](ref:GEN.13) and",
    label: "Study Note",
    text_format: "markdown",
  };

  async function searchStudyNotesFor(q: string) {
    const user = userEvent.setup();
    renderSearch();
    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.type(screen.getByLabelText("Search query"), q);
    await user.click(screen.getByRole("button", { name: "Search" }));
    return screen.findByRole("region", { name: "Study notes results" });
  }

  it("badges a study Bible's note with its own label and names its Bible among several", async () => {
    server.use(
      translationsWithNotes({ EMB: 9, KJV: 0, NET: 12 }),
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () => HttpResponse.json(notesPage([EMB_HIT]))),
    );
    const section = await searchStudyNotesFor("famine");
    expect(within(section).getByText("Study Note")).toBeInTheDocument();
    expect(within(section).queryByText("Study note")).not.toBeInTheDocument();
    // The hit names its Bible in that Bible's look, the same as its markers in the reader.
    const code = await within(within(section).getByRole("list")).findByText("EMB");
    expect(code).toHaveAttribute("data-note-look", "rose-square");
  });

  it("shows a Markdown snippet without its syntax, highlights kept", async () => {
    server.use(
      translationsWithNotes({ EMB: 9, KJV: 0 }),
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () => HttpResponse.json(notesPage([EMB_HIT]))),
    );
    const section = await searchStudyNotesFor("famine");
    const mark = within(section).getByText("famine");
    expect(mark.tagName).toBe("MARK");
    const snippet = mark.parentElement!;
    expect(snippet).toHaveTextContent("A made-up note on famine, see the next chapter and");
    expect(snippet.textContent).not.toMatch(/[*[\]()]|ref:/);
  });

  it("doesn't name the Bible when only one has notes", async () => {
    server.use(
      translationsWithNotes({ EMB: 9, KJV: 0 }),
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () => HttpResponse.json(notesPage([EMB_HIT]))),
    );
    const section = await searchStudyNotesFor("famine");
    expect(within(section).getByText("Study Note")).toBeInTheDocument();
    expect(within(section).queryByText("EMB")).not.toBeInTheDocument();
    // Nothing to choose between, so no filter.
    expect(within(section).queryByRole("radio")).not.toBeInTheDocument();
  });

  it("an older Concord's NET hit looks as before: type badge, no Bible named, snippet as sent", async () => {
    server.use(
      translationsWithNotes({ KJV: undefined, NET: undefined }),
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", () =>
        HttpResponse.json(notesPage([
          {
            book: "JHN",
            chapter: 3,
            verse: 16,
            reference: "John 3:16",
            translation: "NET",
            type: "tn",
            snippet: "A plain *made-up* <mark>note</mark>.",
          },
        ])),
      ),
    );
    const section = await searchStudyNotesFor("note");
    expect(within(section).getByText("Translator’s note")).toBeInTheDocument();
    expect(within(section).queryByText("NET")).not.toBeInTheDocument();
    // A plain-text note's snippet is shown exactly as Concord sent it.
    expect(within(section).getByText("note").parentElement).toHaveTextContent(
      "A plain *made-up* note.",
    );
  });

  // --- Paging and the per-Bible filter (v1.8). Made-up text only. ---

  /**
   * A made-up Concord with `counts` study notes per Bible, all matching any query. Records every
   * study-notes request's parameters and answers with the page asked for.
   */
  function pagedNotes(counts: Record<string, number>) {
    const requests: Record<string, string>[] = [];
    server.use(
      translationsWithNotes({ ...counts, KJV: 0 }),
      http.get("/api/v1/keyword-search", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/study-notes-search", ({ request }) => {
        const params = Object.fromEntries(new URL(request.url).searchParams);
        requests.push(params);
        const all = Object.entries(counts)
          .filter(([code]) => !params.translation || code === params.translation)
          .flatMap(([code, n]) =>
            Array.from({ length: n }, (_, i) => ({
              book: "GEN",
              chapter: 1,
              verse: i + 1,
              reference: `Genesis 1:${i + 1}`,
              translation: code,
              type: "sn",
              snippet: `A made-up <mark>${params.q}</mark> note ${code} ${i + 1}.`,
              label: "Study Note",
              text_format: null,
            })),
          );
        const offset = Number(params.offset ?? 0);
        const limit = Number(params.limit ?? 20);
        return HttpResponse.json(notesPage(all.slice(offset, offset + limit), all.length));
      }),
    );
    return requests;
  }

  const hitCount = (section: HTMLElement) => within(section).queryAllByRole("listitem").length;

  it("pages through study notes: 20 at a time, with how many in all, until the last", async () => {
    const requests = pagedNotes({ EMB: 5, NET: 40 });
    const user = userEvent.setup();
    const section = await searchStudyNotesFor("famine");

    expect(await within(section).findByText("20 of 45")).toBeInTheDocument();
    expect(hitCount(section)).toBe(20);
    expect(requests).toEqual([{ q: "famine", limit: "20", offset: "0" }]);

    await user.click(within(section).getByRole("button", { name: "Load more" }));
    expect(await within(section).findByText("40 of 45")).toBeInTheDocument();
    expect(hitCount(section)).toBe(40);
    expect(requests.at(-1)).toEqual({ q: "famine", limit: "20", offset: "20" });

    await user.click(within(section).getByRole("button", { name: "Load more" }));
    expect(await within(section).findByText("45 of 45")).toBeInTheDocument();
    expect(requests.at(-1)?.offset).toBe("40");
    expect(within(section).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("filters by Bible: picking one searches only its notes, from the first page; All goes back", async () => {
    const requests = pagedNotes({ EMB: 25, NET: 40 });
    const user = userEvent.setup();
    const section = await searchStudyNotesFor("famine");
    await within(section).findByText("20 of 65");
    await user.click(within(section).getByRole("button", { name: "Load more" }));
    await within(section).findByText("40 of 65");

    // One pill per notes Bible, each with its look, after All (the default).
    const radios = within(section).getAllByRole("radio");
    expect(radios.map((r) => r.closest("label")!.textContent)).toEqual(["All", "1EMB", "1NET"]);
    expect(within(section).getByRole("radio", { name: /All/ })).toBeChecked();

    await user.click(within(section).getByRole("radio", { name: /EMB/ }));
    expect(await within(section).findByText("20 of 25")).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({ q: "famine", limit: "20", offset: "0", translation: "EMB" });
    expect(within(section).getAllByText(/note EMB/)).toHaveLength(20);
    expect(within(section).queryByText(/note NET/)).not.toBeInTheDocument();

    // Back to All: the notes already loaded there come back, and nothing asks for EMB.
    await user.click(within(section).getByRole("radio", { name: /All/ }));
    expect(await within(section).findByText("40 of 65")).toBeInTheDocument();
    expect(requests.at(-1)?.translation).toBeUndefined();
  });

  it("says so when a page is empty, naming the Bible when filtered, and keeps the filter", async () => {
    pagedNotes({ EMB: 0, NET: 3 });
    // Both Bibles have notes; none of EMB's matches this query.
    server.use(translationsWithNotes({ EMB: 9, KJV: 0, NET: 12 }));
    const user = userEvent.setup();
    const section = await searchStudyNotesFor("famine");
    await within(section).findByText("3 of 3");

    await user.click(within(section).getByRole("radio", { name: /EMB/ }));
    expect(await within(section).findByText("No EMB notes match “famine”.")).toBeInTheDocument();
    expect(within(section).getByRole("radio", { name: /NET/ })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says no study notes match when none do, from any Bible", async () => {
    pagedNotes({ EMB: 0, NET: 0 });
    server.use(translationsWithNotes({ EMB: 9, KJV: 0, NET: 12 }));
    const section = await searchStudyNotesFor("famine");
    expect(await within(section).findByText("No study notes match “famine”.")).toBeInTheDocument();
  });

  it("a new query keeps the Bible picked and starts again from the first page", async () => {
    const requests = pagedNotes({ EMB: 30, NET: 40 });
    const user = userEvent.setup();
    const section = await searchStudyNotesFor("famine");
    await user.click(await within(section).findByRole("radio", { name: /EMB/ }));
    await within(section).findByText("20 of 30");
    await user.click(within(section).getByRole("button", { name: "Load more" }));
    await within(section).findByText("30 of 30");

    await user.clear(screen.getByLabelText("Search query"));
    await user.type(screen.getByLabelText("Search query"), "harvest");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await within(section).findByText("20 of 30")).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({ q: "harvest", limit: "20", offset: "0", translation: "EMB" });
    expect(within(section).getByRole("radio", { name: /EMB/ })).toBeChecked();
  });

  it("preserves scope selections across the mode toggle (#66)", async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    await user.click(screen.getByRole("checkbox", { name: "Your notes" })); // uncheck
    expect(screen.getByRole("checkbox", { name: "Your notes" })).not.toBeChecked();

    // Round-trip through Semantic and back — the unchecked state survives.
    await user.click(screen.getByRole("tab", { name: "Semantic" }));
    await user.click(screen.getByRole("tab", { name: "Keyword" }));
    expect(screen.getByRole("checkbox", { name: "Your notes" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Scripture" })).toBeChecked();
  });
});
