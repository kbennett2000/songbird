import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { BrowseView } from "@/routes/BrowseView";
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
    tags: ["grace"],
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

const GRACE = note();
const FAITH = note({ id: 2, start_verse: 17, end_verse: 17, note_markdown: "faith note", tags: ["faith"] });

function sermon(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "The Prodigal Son",
    sermon_url: "https://youtu.be/abc123",
    reference: "Luke 15:11-32",
    book_usfm: "LUK",
    book_order_index: 42,
    start_chapter: 15,
    start_verse: 11,
    end_chapter: 15,
    end_verse: 11,
    event_date: null,
    youtube_video_id: null,
    tags: ["grace"],
    author_id: 1,
    created_at: "2026-06-05T00:00:00Z",
    updated_at: "2026-06-05T00:00:00Z",
    ...overrides,
  };
}

const PRODIGAL = sermon();

// Both list endpoints share the same tag-AND filter so the tag chips narrow both note kinds.
function tagFilterHandler<T extends { tags: string[] }>(path: string, all: T[]) {
  return http.get(path, ({ request }) => {
    const tags = new URL(request.url).searchParams.get("tags");
    const filtered = tags
      ? all.filter((a) => tags.split(",").every((t) => a.tags.includes(t)))
      : all;
    return HttpResponse.json(filtered);
  });
}

function browseHandler() {
  return tagFilterHandler("/api/v1/annotations", [GRACE, FAITH]);
}

function sermonHandler() {
  return tagFilterHandler("/api/v1/sermon-notes", [PRODIGAL]);
}

function renderBrowse() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BrowseView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BrowseView", () => {
  it("lists annotations and filters by tag", async () => {
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json(["faith", "grace"])),
      browseHandler(),
    );
    const user = userEvent.setup();
    renderBrowse();

    // Both notes listed, reference prettified via the books list ("John 3:16").
    expect(await screen.findByText("grace note")).toBeInTheDocument();
    expect(screen.getByText("faith note")).toBeInTheDocument();
    expect(screen.getByText("John 3:16")).toBeInTheDocument();

    // Filter by "grace" → only the grace note remains.
    await user.click(screen.getByRole("button", { name: "grace" }));
    expect(await screen.findByText("grace note")).toBeInTheDocument();
    expect(screen.queryByText("faith note")).not.toBeInTheDocument();
  });

  it("lists sermon notes in their own section and filters by tag (issue #24)", async () => {
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json(["faith", "grace"])),
      browseHandler(),
      sermonHandler(),
    );
    const user = userEvent.setup();
    renderBrowse();

    // The sermon note renders with its title, canonical reference, and a "Sermon" badge.
    expect(await screen.findByText("The Prodigal Son")).toBeInTheDocument();
    expect(screen.getByText("Luke 15:11")).toBeInTheDocument();
    expect(screen.getByText("Sermon")).toBeInTheDocument();

    // The shared tag filter narrows sermon notes too: "faith" (which the sermon lacks) hides it
    // while the faith annotation stays.
    await user.click(screen.getByRole("button", { name: "faith" }));
    expect(await screen.findByText("faith note")).toBeInTheDocument();
    expect(screen.queryByText("The Prodigal Son")).not.toBeInTheDocument();
  });

  it("imports a notes file, shows a summary, and refreshes the lists (issue #41)", async () => {
    let imported = false;
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json(imported ? [GRACE] : [])),
      http.get("/api/v1/sermon-notes", () => HttpResponse.json([])),
      http.post("/api/v1/import", () => {
        imported = true;
        return HttpResponse.json({
          annotations: { created: 1, skipped: 2, failed: 0 },
          sermon_notes: { created: 0, skipped: 0, failed: 0 },
          errors: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderBrowse();

    expect(await screen.findByText("No notes match.")).toBeInTheDocument();

    const file = new File(
      [JSON.stringify({ version: 1, annotations: [], sermon_notes: [] })],
      "songbird-notes.json",
      { type: "application/json" },
    );
    await user.upload(screen.getByLabelText("Import notes file"), file);

    // Summary reflects the server tally; the (now non-empty) list has refetched.
    expect(await screen.findByText("Imported 1 · skipped 2")).toBeInTheDocument();
    expect(await screen.findByText("grace note")).toBeInTheDocument();
  });

  it("exports notes to a downloaded JSON file (issue #41)", async () => {
    let exportHit = false;
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json([])),
      http.get("/api/v1/export", () => {
        exportHit = true;
        return HttpResponse.json({
          version: 1,
          exported_at: null,
          annotations: [],
          sermon_notes: [],
        });
      }),
    );
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      const user = userEvent.setup();
      renderBrowse();
      await user.click(await screen.findByRole("button", { name: "Export" }));

      await waitFor(() => expect(exportHit).toBe(true));
      expect(click).toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      click.mockRestore();
    }
  });

  it("jumps to the verse in the reader", async () => {
    server.use(http.get("/api/v1/tags", () => HttpResponse.json(["grace"])), browseHandler());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Probe = () => <div>reader-at {useLocation().search}</div>;

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/browse"]}>
          <Routes>
            <Route path="/browse" element={<BrowseView />} />
            <Route path="/read" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const open = await screen.findAllByRole("link", { name: "Open in reader" });
    await user.click(open[0]!);
    expect(await screen.findByText(/book=JHN&chapter=3&verse=16/)).toBeInTheDocument();
  });
  // --- Re-dating YouTube sermons (v1.7 sermon sources, spec §11) ---------------------------

  // Two notes: one whose date YouTube would move, one already correct. The muted row still has
  // to be there — "we checked everything" is part of what the preview says.
  const REDATE_PREVIEW = {
    dry_run: true,
    total_youtube_notes: 3,
    items: [
      {
        id: 1,
        title: "The Prodigal Son",
        reference: "Luke 15:11-32",
        sermon_url: "https://youtu.be/abc12345678",
        video_id: "abc12345678",
        current_date: "2026-01-05",
        new_date: "2026-02-02",
        date_source: "stream_start" as const,
        changed: true,
      },
      {
        id: 2,
        title: "Already Right",
        reference: "Acts 2:42",
        sermon_url: "https://youtu.be/def12345678",
        video_id: "def12345678",
        current_date: "2025-05-11",
        new_date: "2025-05-11",
        date_source: "published" as const,
        changed: false,
      },
    ],
    not_found: [
      {
        id: 3,
        title: "A Removed Video",
        reference: "John 1:1",
        sermon_url: "https://youtu.be/ghi12345678",
        video_id: "ghi12345678",
      },
    ],
    skipped_non_youtube: 1,
    applied: 0,
  };

  async function openPreview(body: typeof REDATE_PREVIEW = REDATE_PREVIEW) {
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json(["grace"])),
      browseHandler(),
      sermonHandler(),
      http.post("/api/v1/sermon-notes/redate", () => HttpResponse.json(body)),
    );
    const user = userEvent.setup();
    renderBrowse();
    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));
    return user;
  }

  it("previews what would change, what wouldn't, and what YouTube couldn't find", async () => {
    await openPreview();

    const dialog = await screen.findByRole("dialog", { name: "Re-date YouTube sermons" });
    // The counts line, as a sentence.
    expect(dialog).toHaveTextContent("3 sermon notes link to YouTube");
    expect(dialog).toHaveTextContent("1 date would change");
    expect(dialog).toHaveTextContent("1 note isn’t on YouTube");
    // The changing row shows both dates and which timestamp decided the new one.
    expect(dialog).toHaveTextContent("Jan 5, 2026");
    expect(dialog).toHaveTextContent("Feb 2, 2026");
    expect(dialog).toHaveTextContent("stream started");
    // The unchanged row is shown, not hidden.
    expect(dialog).toHaveTextContent("Already Right");
    expect(dialog).toHaveTextContent("already correct");
    // And the ones YouTube couldn't find get their own list, with the reassurance.
    expect(dialog).toHaveTextContent("A Removed Video");
    expect(dialog).toHaveTextContent(/private or have been removed/);
  });

  it("disables Apply when nothing would change", async () => {
    // Nothing is written on a dry run, so a preview with no changes must not offer to write.
    await openPreview({
      ...REDATE_PREVIEW,
      items: REDATE_PREVIEW.items.filter((i) => !i.changed),
      not_found: [],
      total_youtube_notes: 1,
      skipped_non_youtube: 0,
    });

    expect(await screen.findByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText("Every date already matches YouTube.")).toBeInTheDocument();
  });

  it("applies the new dates and refreshes the sermon list", async () => {
    let applied = false;
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json(["grace"])),
      browseHandler(),
      // The list refetches after the apply, so a stateful handler proves the invalidation ran.
      http.get("/api/v1/sermon-notes", () =>
        HttpResponse.json([
          sermon({ title: applied ? "The Prodigal Son (re-dated)" : "The Prodigal Son" }),
        ]),
      ),
      http.post("/api/v1/sermon-notes/redate", ({ request }) => {
        const dryRun = new URL(request.url).searchParams.get("dry_run");
        if (dryRun === "false") {
          applied = true;
          return HttpResponse.json({ ...REDATE_PREVIEW, dry_run: false, applied: 1 });
        }
        return HttpResponse.json(REDATE_PREVIEW);
      }),
    );
    // This one renders with the APP's query defaults, not the bare test client. The bare client
    // leaves refetchOnWindowFocus on, so userEvent's focus events refetch the list on their own
    // and the assertion below would pass with the invalidation deleted — a test that can't fail.
    // With focus-refetching off and a 30s staleTime, only the invalidation can refresh the list.
    const client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <BrowseView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    // One-line result, the dialog gone, and the (now different) list refetched.
    expect(await screen.findByText("Re-dated 1 sermon note.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("The Prodigal Son (re-dated)")).toBeInTheDocument();
  });

  it("marks the reader's chapter cache stale too", async () => {
    // A re-date changes event_date, which the reader shows on its sermon markers. Nothing on
    // this page can observe that, so the assertion is against the cache itself — otherwise the
    // second invalidation would be untested and could be deleted without a test noticing.
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json([])),
      http.get("/api/v1/annotations", () => HttpResponse.json([])),
      http.get("/api/v1/sermon-notes", () => HttpResponse.json([])),
      http.post("/api/v1/sermon-notes/redate", ({ request }) =>
        HttpResponse.json({
          ...REDATE_PREVIEW,
          dry_run: new URL(request.url).searchParams.get("dry_run") !== "false",
          applied: 1,
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
    });
    const chapterKey = ["chapter", "KJV", "JHN", 3];
    client.setQueryData(chapterKey, { verses: [] });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <BrowseView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    expect(client.getQueryState(chapterKey)?.isInvalidated).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(client.getQueryState(chapterKey)?.isInvalidated).toBe(true),
    );
  });

  it("explains what to set when there is no YouTube API key", async () => {
    // No dead button and no silent failure: without a key the click says what's missing.
    server.use(
      http.get("/api/v1/tags", () => HttpResponse.json(["grace"])),
      browseHandler(),
      sermonHandler(),
      http.post("/api/v1/sermon-notes/redate", () =>
        HttpResponse.json(
          { detail: { code: "YOUTUBE_NOT_CONFIGURED", message: "switched off" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderBrowse();

    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));

    expect(await screen.findByText(/set YOUTUBE_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
