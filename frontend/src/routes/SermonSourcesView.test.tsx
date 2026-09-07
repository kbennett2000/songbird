import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
    check_requested_at: null,
    counts: { pending: 0, needs_passage: 0, placed: 0, skipped: 0, already_noted: 0 },
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

function ledgerVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source_id: 1,
    source_title: "Cornerstone Chapel",
    video_id: "dQw4w9WgXcQ",
    title: "An in-depth study of 2 Chronicles 29",
    published_at: "2026-09-06T14:55:12Z",
    duration_seconds: 5040,
    is_live: false,
    status: "pending",
    skip_reason: null,
    placed_by: null,
    suggestions: [],
    seen_at: "2026-09-07T00:00:00Z",
    decided_at: null,
    ...overrides,
  };
}

const PENDING_VIDEO = ledgerVideo();
const SKIPPED_VIDEO = ledgerVideo({
  id: 2,
  video_id: "abcdefghijk",
  title: "A two-minute welcome",
  published_at: "2026-08-30T14:55:12Z",
  duration_seconds: 120,
  status: "skipped",
  skip_reason: "too_short",
});

/** The sources list alone. A source's title also appears as an option in the ledger's source
 * filter below, so an unscoped query for it now matches twice — this says which one is meant. */
function sourceList() {
  return within(screen.getByRole("region", { name: "Sources" }));
}

/** The ledger's list alone. Its state words also appear as options in the state filter above it,
 * so an unscoped query matches twice — `ul` is the list of rows and nothing else. */
function ledgerRows() {
  return within(
    within(screen.getByRole("region", { name: "What songbird found" })).getByRole("list"),
  );
}

/** The status endpoint gates the whole page, so every test has to answer it. */
function statusHandler(configured = true, minMinutesDefault = 10, scanRunning = false) {
  return http.get("/api/v1/sermon-sources/status", () =>
    HttpResponse.json({
      configured,
      min_minutes_default: minMinutesDefault,
      scan_running: scanRunning,
      scan_started_at: scanRunning ? "2026-09-07T12:00:00Z" : null,
    }),
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

    await screen.findByRole("region", { name: "Sources" });
    expect(sourceList().getByText("Cornerstone Chapel")).toBeInTheDocument();
    // A channel that follows the app-wide minimum reads it as a number, not as "default".
    expect(
      screen.getByText(/Channel · includes livestreams · 10 minutes or longer · never checked/),
    ).toBeInTheDocument();
    expect(screen.getByText("sunday")).toBeInTheDocument();

    // A playlist with its own overrides, paused.
    expect(sourceList().getByText("Sunday Teaching")).toBeInTheDocument();
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
    expect(await sourceList().findByText("Cornerstone Chapel")).toBeInTheDocument();
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
    expect(sourceList().getByText("Cornerstone Chapel")).toBeInTheDocument();
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

  // ---- Checking, counts and the ledger (v1.7 slice 4a) --------------------------------------

  it("queues a check and says nothing, because the indicator says it instead", async () => {
    let queued = false;
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.post("/api/v1/sermon-sources/check", () => {
        queued = true;
        return HttpResponse.json({ queued: 1 }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await user.click(await screen.findByRole("button", { name: "Check all now" }));

    await waitFor(() => expect(queued).toBe(true));
    // Someone who pressed the button is told something started — and told it exactly once.
    // Two live regions talk over each other for a screen reader, which is what the browser pass
    // found when the indicator carried a `role="status"` of its own.
    const announced = await screen.findByRole("status");
    expect(announced).toHaveTextContent("Checking your sources…");
    expect(screen.queryAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText(/Nothing to check/)).not.toBeInTheDocument();
  });

  it("says so plainly when every source is paused", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(source({ enabled: false })),
      http.post("/api/v1/sermon-sources/check", () =>
        HttpResponse.json({ queued: 0 }, { status: 202 }),
      ),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await user.click(await screen.findByRole("button", { name: "Check all now" }));

    // Nothing failed — the request was accepted and there was nothing in it.
    expect(await screen.findByText("Nothing to check — every source is paused.")).toBeInTheDocument();
  });

  it("checks one source on its own", async () => {
    const asked: string[] = [];
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.post("/api/v1/sermon-sources/1/check", () => {
        asked.push("1");
        return HttpResponse.json({ queued: 1 }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await user.click(await screen.findByRole("button", { name: "Check now" }));

    await waitFor(() => expect(asked).toEqual(["1"]));
  });

  it("offers no Check now on a paused source", async () => {
    // The runner only ever picks up enabled sources, so the button would have nothing to do —
    // absent rather than disabled, because a disabled control still invites a press.
    server.use(statusHandler(), sourcesHandler(source({ enabled: false })));
    renderPage();

    await screen.findByRole("region", { name: "Sources" });
    expect(screen.queryByRole("button", { name: "Check now" })).not.toBeInTheDocument();
    // …and the whole-list button is still there, because it is about the list, not this row.
    expect(screen.getByRole("button", { name: "Check all now" })).toBeInTheDocument();
  });

  it("shows a check is running, and disables the buttons that would start another", async () => {
    server.use(statusHandler(true, 10, true), sourcesHandler(CORNERSTONE));
    renderPage();

    expect(await screen.findByText("Checking your sources…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check all now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    // Nothing to announce: this page was loaded while a check was already running, so the reader
    // did nothing that needs a reply. The indicator is visual state, not a live region.
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("says a source is waiting its turn once one has been asked for", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(source({ check_requested_at: "2026-09-07T12:00:00Z" })),
    );
    renderPage();

    expect(await screen.findByText(/waiting to be checked/)).toBeInTheDocument();
    // Already queued, so pressing again would do nothing.
    expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
  });

  it("reads the last check as a date, and its failure as a sentence", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(
        source({
          last_checked_at: "2026-09-06T14:55:12Z",
          last_check_status: "Couldn't reach YouTube. songbird will try again at the next check.",
        }),
      ),
    );
    renderPage();

    // A real date, not the raw timestamp the placeholder used to print.
    expect(await screen.findByText(/checked Sep 6, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last check: Couldn't reach YouTube/)).toBeInTheDocument();
  });

  it("shows what a source has found, and stays quiet about the zeros", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(
        source({
          counts: { pending: 3, needs_passage: 0, placed: 0, skipped: 12, already_noted: 1 },
        }),
      ),
    );
    renderPage();

    await screen.findByRole("region", { name: "Sources" });
    const list = sourceList();
    expect(list.getByText("3")).toBeInTheDocument();
    expect(list.getByText("waiting")).toBeInTheDocument();
    expect(list.getByText("skipped")).toBeInTheDocument();
    expect(list.getByText("already noted")).toBeInTheDocument();
    // A source that has never placed anything doesn't display noughts to say so.
    expect(list.queryByText("placed")).not.toBeInTheDocument();
    expect(list.queryByText("needs a passage")).not.toBeInTheDocument();
  });

  it("lists what songbird found, in the reader's words", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json({ videos: [PENDING_VIDEO, SKIPPED_VIDEO], total: 2 }),
      ),
    );
    renderPage();

    expect(await screen.findByText("An in-depth study of 2 Chronicles 29")).toBeInTheDocument();
    expect(screen.getByText("Sep 6, 2026")).toBeInTheDocument();
    expect(screen.getByText("Aug 30, 2026")).toBeInTheDocument();
    expect(screen.getByText("1 hr 24 min")).toBeInTheDocument();
    expect(ledgerRows().getByText("Waiting")).toBeInTheDocument();
    expect(ledgerRows().getByText("Skipped")).toBeInTheDocument();
    // The reason reads as a phrase, not as a field name.
    expect(screen.getByText("shorter than this source's minimum")).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("says a video of unknown length is unknown, not zero", async () => {
    // Spec §6: an unknown duration was never filtered on length at all, so "0 min" would claim
    // the opposite of what songbird actually decided.
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json({
          videos: [{ ...PENDING_VIDEO, duration_seconds: null }],
          total: 1,
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText("length unknown")).toBeInTheDocument();
  });

  it("filters the ledger by state", async () => {
    const asked: (string | null)[] = [];
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.get("/api/v1/sermon-sources/videos", ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        asked.push(status);
        return HttpResponse.json({
          videos: status === "skipped" ? [SKIPPED_VIDEO] : [PENDING_VIDEO, SKIPPED_VIDEO],
          total: status === "skipped" ? 1 : 2,
        });
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    await screen.findByText("An in-depth study of 2 Chronicles 29");
    await user.selectOptions(screen.getByLabelText("Filter by state"), "skipped");

    expect(await screen.findByText("1 of 1")).toBeInTheDocument();
    expect(asked).toEqual([null, "skipped"]);
  });

  it("pages the ledger rather than asking for everything", async () => {
    server.use(
      statusHandler(),
      sourcesHandler(CORNERSTONE),
      http.get("/api/v1/sermon-sources/videos", ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset"));
        return HttpResponse.json({
          videos: [{ ...PENDING_VIDEO, id: offset + 1, title: `Sermon at ${offset}` }],
          total: 2,
        });
      }),
    );
    const user = userEvent.setup();
    renderPage(appClient());

    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Sermon at 1")).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    // Everything is loaded, so there is nothing left to press.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("invites a first check when there is nothing found yet", async () => {
    server.use(statusHandler(), sourcesHandler(CORNERSTONE));
    renderPage();

    expect(
      await screen.findByText(/Nothing yet. Press Check all now and songbird will go and look./),
    ).toBeInTheDocument();
  });

  it("stops asking once the check is done, and refreshes what it found", async () => {
    // The only test in this suite that needs fake timers, because the behaviour IS the passage of
    // time: a poll that never stops looks identical to a correct one in a single snapshot.
    vi.useFakeTimers();
    try {
      let running = true;
      let statusCalls = 0;
      let sourceCalls = 0;
      server.use(
        http.get("/api/v1/sermon-sources/status", () => {
          statusCalls += 1;
          return HttpResponse.json({
            configured: true,
            min_minutes_default: 10,
            scan_running: running,
            scan_started_at: running ? "2026-09-07T12:00:00Z" : null,
          });
        }),
        http.get("/api/v1/sermon-sources", () => {
          sourceCalls += 1;
          return HttpResponse.json([CORNERSTONE]);
        }),
      );
      renderPage(appClient());

      await vi.advanceTimersByTimeAsync(50);
      expect(screen.getByText("Checking your sources…")).toBeInTheDocument();
      const whileRunning = statusCalls;

      // It keeps asking while there is something to watch…
      await vi.advanceTimersByTimeAsync(3100);
      expect(statusCalls).toBeGreaterThan(whileRunning);

      // …the check finishes…
      running = false;
      const sourcesBefore = sourceCalls;
      await vi.advanceTimersByTimeAsync(3100);
      expect(screen.queryByText("Checking your sources…")).not.toBeInTheDocument();
      // …the counts and the ledger are refreshed, because nothing else would tell them…
      expect(sourceCalls).toBeGreaterThan(sourcesBefore);

      // …and then it goes quiet. This is the assertion the whole test exists for.
      const afterFinishing = statusCalls;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(statusCalls).toBe(afterFinishing);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops asking when songbird stops answering", async () => {
    // A query keeps its last successful data through a failure, so without the error guard on the
    // interval a songbird that had gone away would be asked every three seconds for as long as
    // the tab stayed open — the last good answer saying "still checking" for ever.
    vi.useFakeTimers();
    try {
      let calls = 0;
      server.use(
        http.get("/api/v1/sermon-sources/status", () => {
          calls += 1;
          return calls === 1
            ? HttpResponse.json({
                configured: true,
                min_minutes_default: 10,
                scan_running: true,
                scan_started_at: "2026-09-07T12:00:00Z",
              })
            : new HttpResponse(null, { status: 503 });
        }),
        sourcesHandler(CORNERSTONE),
      );
      renderPage(appClient());

      await vi.advanceTimersByTimeAsync(50);
      expect(screen.getByText("Checking your sources…")).toBeInTheDocument(); // the poll started

      // The second ask fails; nothing should ask a third time.
      await vi.advanceTimersByTimeAsync(3100);
      const afterFailing = calls;
      expect(afterFailing).toBeGreaterThan(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls).toBe(afterFailing);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the ledger before there is a source to fill it", async () => {
    server.use(statusHandler(), sourcesHandler());
    renderPage();

    expect(await screen.findByText(/No sources yet/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "What songbird found" })).not.toBeInTheDocument();
  });
});
