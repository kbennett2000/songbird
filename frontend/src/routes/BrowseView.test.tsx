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
            <Route path="/" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const open = await screen.findAllByRole("link", { name: "Open in reader" });
    await user.click(open[0]!);
    expect(await screen.findByText(/book=JHN&chapter=3&verse=16/)).toBeInTheDocument();
  });
});
