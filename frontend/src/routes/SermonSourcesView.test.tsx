import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SermonSourcesView } from "@/routes/SermonSourcesView";
import { server } from "@/test/msw/server";

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    kind: "channel",
    youtube_id: "UCa1b2c3d4e5f6g7h8i9j0k1",
    uploads_playlist_id: "UUa1b2c3d4e5f6g7h8i9j0k1",
    input_url: "https://www.youtube.com/@cornerstonechpl",
    title: "Cornerstone Chapel",
    enabled: true,
    include_live: true,
    min_minutes: null,
    last_checked_at: null,
    last_check_status: null,
    tags: ["sunday"],
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const CORNERSTONE = source();
const TEACHING = source({
  id: 2,
  kind: "playlist",
  youtube_id: "PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t",
  uploads_playlist_id: null,
  input_url: "https://www.youtube.com/playlist?list=PLw5K9iridI-CW2ABjjNWoHQAwomBqHV5t",
  title: "Sunday Teaching",
  include_live: false,
  min_minutes: 25,
  enabled: false,
  tags: [],
});

/** The status endpoint gates the whole page, so every test has to answer it. */
function statusHandler(configured = true, minMinutesDefault = 10) {
  return http.get("/api/v1/sermon-sources/status", () =>
    HttpResponse.json({ configured, min_minutes_default: minMinutesDefault }),
  );
}

function sourcesHandler(...sources: ReturnType<typeof source>[]) {
  return http.get("/api/v1/sermon-sources", () => HttpResponse.json(sources));
}

/** The app's real query defaults, so a refetch can only come from an invalidation. */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
    },
  });
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SermonSourcesView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe("SermonSourcesView", () => {
  it("lists each source with what it is and how it's filtered", async () => {
    server.use(statusHandler(), sourcesHandler(CORNERSTONE, TEACHING));
    renderPage();

    expect(await screen.findByText("Cornerstone Chapel")).toBeInTheDocument();
    // A channel that follows the app-wide minimum reads it as a number, not as "default".
    expect(
      screen.getByText(/Channel · includes livestreams · 10 minutes or longer · never checked/),
    ).toBeInTheDocument();
    expect(screen.getByText("sunday")).toBeInTheDocument();

    // A playlist with its own overrides, paused.
    expect(screen.getByText("Sunday Teaching")).toBeInTheDocument();
    expect(
      screen.getByText(/Playlist · no livestreams · 25 minutes or longer · never checked/),
    ).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("invites a first source when there are none", async () => {
    server.use(statusHandler(), sourcesHandler());
    renderPage();

    expect(await screen.findByText(/No sources yet/)).toBeInTheDocument();
  });

  it("shows only the setup message when there is no API key", async () => {
    // Spec §10: without a key the page is one explanation and nothing else — no list to load,
    // no controls that would fail if pressed.
    server.use(statusHandler(false));
    renderPage();

    expect(await screen.findByText(/YOUTUBE_API_KEY=your-key-here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add source" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Re-date YouTube sermons" }),
    ).not.toBeInTheDocument();
  });

  it("adds a source and shows it in the list", async () => {
    let added = false;
    server.use(
      statusHandler(),
      http.get("/api/v1/sermon-sources", () =>
        HttpResponse.json(added ? [CORNERSTONE] : []),
      ),
      http.post("/api/v1/sermon-sources", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        // An empty minutes field sends null — the source FOLLOWS the app-wide default rather
        // than pinning a copy of today's value.
        expect(body).toEqual({
          url: "https://www.youtube.com/@cornerstonechpl",
          tags: ["sunday"],
          include_live: true,
          min_minutes: null,
        });
        added = true;
        return HttpResponse.json(CORNERSTONE, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await user.click(await screen.findByRole("button", { name: "Add source" }));
    await user.type(
      screen.getByLabelText(/Channel or playlist link/),
      "https://www.youtube.com/@cornerstonechpl",
    );
    await user.type(screen.getByLabelText("Add a tag"), "sunday");
    await user.click(screen.getByRole("button", { name: "Add source" }));

    expect(await screen.findByText("Added Cornerstone Chapel.")).toBeInTheDocument();
    // Only the invalidation can refresh the list with these query defaults.
    expect(await screen.findByText("Cornerstone Chapel")).toBeInTheDocument();
  });

  it("won't submit an empty link", async () => {
    server.use(statusHandler(), sourcesHandler());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Add source" }));

    // The form's own submit button, not the disclosure that opened it.
    const submits = screen.getAllByRole("button", { name: "Add source" });
    expect(submits[submits.length - 1]).toBeDisabled();
  });

  it("explains a link it can't read, in the words of the person who pasted it", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(),
      http.post("/api/v1/sermon-sources", () =>
        HttpResponse.json(
          {
            detail: {
              code: "INVALID_SOURCE_URL",
              message: "That doesn't look like a YouTube channel or playlist link. Paste the "
                + "channel's @handle link (like youtube.com/@yourchurch).",
            },
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Add source" }));
    await user.type(
      screen.getByLabelText(/Channel or playlist link/),
      "https://www.youtube.com/c/CornerstoneChapel",
    );
    const submits = screen.getAllByRole("button", { name: "Add source" });
    await user.click(submits[submits.length - 1]!);

    expect(await screen.findByText(/@handle link/)).toBeInTheDocument();
  });

  it("edits a source, sending an explicit null to clear a minutes override", async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      statusHandler(),
      http.get("/api/v1/sermon-sources", () =>
        HttpResponse.json([patched ? source({ min_minutes: null }) : source({ min_minutes: 25 })]),
      ),
      http.patch("/api/v1/sermon-sources/1", async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(source({ min_minutes: null }));
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText(/Shortest video to count as a sermon/));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved Cornerstone Chapel.")).toBeInTheDocument();
    // Explicitly null, not omitted: omitted would mean "leave it alone" and the override could
    // never be cleared. This is the assertion that keeps the server's model_fields_set honest.
    expect(patched).toEqual({
      tags: ["sunday"],
      enabled: true,
      include_live: true,
      min_minutes: null,
    });
    expect(await screen.findByText(/10 minutes or longer/)).toBeInTheDocument();
  });

  it("cannot be pointed at a different channel from the edit form", async () => {
    server.use(statusHandler(), sourcesHandler(CORNERSTONE));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.queryByLabelText(/Channel or playlist link/)).not.toBeInTheDocument();
    expect(screen.getByText(/delete this one and add the new one/)).toBeInTheDocument();
  });

  it("asks before deleting, and says the notes are safe", async () => {
    let deleted = false;
    server.use(
      statusHandler(),
      http.get("/api/v1/sermon-sources", () =>
        HttpResponse.json(deleted ? [] : [CORNERSTONE]),
      ),
      http.delete("/api/v1/sermon-sources/1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    // The first press asks rather than deletes, and names what's going.
    expect(screen.getByText(/Remove Cornerstone Chapel\?/)).toBeInTheDocument();
    expect(deleted).toBe(false);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/Your sermon notes are safe/)).toBeInTheDocument();
    expect(await screen.findByText(/No sources yet/)).toBeInTheDocument();
  });

  it("lets you back out of a delete", async () => {
    server.use(statusHandler(), sourcesHandler(CORNERSTONE));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/Remove Cornerstone Chapel\?/)).not.toBeInTheDocument();
    expect(screen.getByText("Cornerstone Chapel")).toBeInTheDocument();
  });

  // --- Re-dating YouTube sermons (v1.7 spec §11) -------------------------------------------
  //
  // Moved here from Browse, which held the button only until this page existed. Two notes: one
  // whose date YouTube would move, one already correct. The muted row still has to be there —
  // "we checked everything" is part of what the preview says.

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
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.post("/api/v1/sermon-notes/redate", () => HttpResponse.json(body)),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));
    return user;
  }

  it("previews what would change, what wouldn't, and what YouTube couldn't find", async () => {
    await openPreview();

    const dialog = await screen.findByRole("dialog", { name: "Re-date YouTube sermons" });
    // The counts line, as a sentence.
    expect(dialog).toHaveTextContent("3 sermon notes link to YouTube");
    expect(dialog).toHaveTextContent("1 date would change");
    // "links somewhere else", not "isn't on YouTube": the section below is headed "Couldn't be
    // found on YouTube" and means a different group entirely. Seeing both in a browser is what
    // showed the two phrasings collide.
    expect(dialog).toHaveTextContent("1 note links somewhere else");
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
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.post("/api/v1/sermon-notes/redate", ({ request }) => {
        const dryRun = new URL(request.url).searchParams.get("dry_run");
        return dryRun === "false"
          ? HttpResponse.json({ ...REDATE_PREVIEW, dry_run: false, applied: 1 })
          : HttpResponse.json(REDATE_PREVIEW);
      }),
    );
    // Nothing on THIS page renders sermon notes, so the refresh is asserted against the cache.
    const client = appClient();
    const browseKey = ["browse-sermon", []];
    client.setQueryData(browseKey, []);
    renderPage(client);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    // One-line result, and the dialog gone.
    expect(await screen.findByText("Re-dated 1 sermon note.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryState(browseKey)?.isInvalidated).toBe(true));
  });

  it("marks the reader's chapter cache stale too", async () => {
    // A re-date changes event_date, which the reader shows on its sermon markers. Nothing on
    // this page can observe that, so the assertion is against the cache itself — otherwise the
    // second invalidation would be untested and could be deleted without a test noticing.
    server.use(
      statusHandler(),
      sourcesHandler(),
      http.post("/api/v1/sermon-notes/redate", ({ request }) =>
        HttpResponse.json({
          ...REDATE_PREVIEW,
          dry_run: new URL(request.url).searchParams.get("dry_run") !== "false",
          applied: 1,
        }),
      ),
    );
    const client = appClient();
    const chapterKey = ["chapter", "KJV", "JHN", 3];
    client.setQueryData(chapterKey, { verses: [] });
    renderPage(client);
    const user = userEvent.setup();

    expect(client.getQueryState(chapterKey)?.isInvalidated).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));
    await user.click(await screen.findByRole("button", { name: "Apply" }));

    await waitFor(() => expect(client.getQueryState(chapterKey)?.isInvalidated).toBe(true));
  });

  it("explains what to set if the key stops working", async () => {
    // The button only appears when a key IS configured, so this is the case where it stopped
    // working since the page loaded. No silent failure: the click says what's missing.
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.post("/api/v1/sermon-notes/redate", () =>
        HttpResponse.json(
          { detail: { code: "YOUTUBE_NOT_CONFIGURED", message: "switched off" } },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Re-date YouTube sermons" }));

    expect(await screen.findByText(/set YOUTUBE_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
