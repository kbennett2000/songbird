import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SermonVideoLedger } from "@/components/SermonVideoLedger";
import { EMPTY_LEDGER_COUNTS } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

/**
 * The review list (v1.7 sermon sources, spec §8).
 *
 * Written against the shape of the real data: hundreds of dated livestreams, worked through over
 * months. So most of these are about the two things that go wrong at that scale — a row acted on
 * losing your place in the list, and a bulk button promising a number the server will not deliver.
 */

const SOURCES = [
  { id: 1, title: "Majestic View" },
  { id: 2, title: "Cornerstone Chapel" },
] as unknown as Parameters<typeof SermonVideoLedger>[0]["sources"];

function video(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source_id: 1,
    source_title: "Majestic View",
    video_id: "dQw4w9WgXcQ",
    title: "Livestream Sunday Worship Service - Mar. 15 2026",
    published_at: "2026-09-07T04:32:29Z",
    actual_start_time: "2026-09-06T14:55:12Z",
    duration_seconds: 5040,
    is_live: true,
    status: "needs_passage",
    skip_reason: null,
    placed_by: null,
    suggestions: ["Psalms 23", "John 3:16"],
    notes: [],
    seen_at: "2026-09-07T00:00:00Z",
    decided_at: "2026-09-07T00:00:00Z",
    ...overrides,
  };
}

function page(videos: unknown[], counts: Record<string, number> = {}) {
  return {
    videos,
    total: videos.length,
    counts: { ...EMPTY_LEDGER_COUNTS, needs_passage: videos.length, ...counts },
  };
}

/** Reproduces the app's real defaults, so a refetch can only come from an invalidation. */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function renderList(client = appClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SermonVideoLedger sources={SOURCES} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rows() {
  return within(screen.getByRole("list", { name: "Videos" }));
}

/** The card carrying this title. By title rather than by index: a row's suggestion chips are
 * `<li>`s of their own, so "the first list item" is not reliably "the first row". */
function row(title: string) {
  const card = screen.getByText(title).closest("li");
  expect(card).not.toBeNull();
  return within(card as HTMLElement);
}

/** The ledger handler, recording the query string of every request it answers. */
function ledger(asked: string[], body: (url: URL) => Record<string, unknown>) {
  return http.get("/api/v1/sermon-sources/videos", ({ request }) => {
    const url = new URL(request.url);
    asked.push(url.search);
    return HttpResponse.json(body(url));
  });
}

describe("SermonVideoLedger", () => {
  it("narrows the list by source, state, dates and a title search", async () => {
    const asked: string[] = [];
    server.use(ledger(asked, () => page([video()])));
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Livestream Sunday Worship Service - Mar. 15 2026");
    await user.selectOptions(screen.getByLabelText("Filter by source"), "1");
    await user.selectOptions(screen.getByLabelText("Filter by state"), "needs_passage");
    await user.type(screen.getByLabelText("Published on or after"), "2024-01-01");
    await user.type(screen.getByLabelText("Published on or before"), "2024-12-31");
    // Typing does not refetch — only pressing Search does, or every keystroke would be a request.
    await user.type(screen.getByLabelText("Search titles"), "livestream");
    const beforeSearch = asked.length;
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("Livestream Sunday Worship Service - Mar. 15 2026");
    expect(asked.length).toBe(beforeSearch + 1);
    const last = new URLSearchParams(asked[asked.length - 1]);
    expect(last.get("source_id")).toBe("1");
    expect(last.get("status")).toBe("needs_passage");
    expect(last.get("published_after")).toBe("2024-01-01");
    expect(last.get("published_before")).toBe("2024-12-31");
    expect(last.get("q")).toBe("livestream");
  });

  it("puts the number of rows waiting beside every state", async () => {
    // The first useful act on a list of hundreds is making it smaller, and these numbers are what
    // say where the work is.
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(page([video()], { needs_passage: 351, placed: 13, skipped: 7 })),
      ),
    );
    renderList();

    expect(await screen.findByRole("option", { name: "Needs a passage (351)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Placed (13)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Skipped (7)" })).toBeInTheDocument();
  });

  it("places the suggestions you tapped, and the one you typed with them", async () => {
    let sent: unknown = null;
    server.use(
      http.get("/api/v1/sermon-sources/videos", () => HttpResponse.json(page([video()]))),
      http.post("/api/v1/sermon-sources/videos/1/place", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(
          video({ status: "placed", placed_by: "manual", notes: [] }),
        );
      }),
    );
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Psalms 23" }));
    await user.type(screen.getByLabelText("Or type one"), "Acts 7:33-35");
    await user.click(screen.getByRole("button", { name: "Place" }));

    await screen.findByRole("button", { name: "Wrong passage" });
    expect(sent).toEqual({ references: ["Psalms 23", "Acts 7:33-35"] });
  });

  it("cannot place nothing", async () => {
    server.use(
      http.get("/api/v1/sermon-sources/videos", () => HttpResponse.json(page([video()]))),
    );
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByRole("button", { name: "Place" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "John 3:16" }));
    expect(screen.getByRole("button", { name: "Place" })).toBeEnabled();
  });

  it("keeps the row where it is after you place it, and asks the server for nothing more", async () => {
    // The row is one of hundreds. Refetching would throw away every page loaded so far and the
    // reader's place in the list; the undo has to be right there instead.
    const asked: string[] = [];
    server.use(
      ledger(asked, () =>
        page([
          video({ id: 1 }),
          // Different suggestions, so "the chip on the first row" is unambiguous.
          video({ id: 2, title: "Another service", suggestions: ["Exodus 3:5-10"] }),
        ]),
      ),
      http.post("/api/v1/sermon-sources/videos/1/place", () =>
        HttpResponse.json(
          video({
            status: "placed",
            placed_by: "manual",
            notes: [
              { id: 11, reference: "Psalms 23", book_usfm: "PSA", start_chapter: 23 },
            ],
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Another service");
    const placed = "Livestream Sunday Worship Service - Mar. 15 2026";
    await user.click(row(placed).getByRole("button", { name: "Psalms 23" }));
    await user.click(row(placed).getByRole("button", { name: "Place" }));

    await screen.findByRole("button", { name: "Wrong passage" });
    // Still where it was, still two rows, and its undo is on it: nothing moved, nothing refetched.
    expect(row(placed).getByRole("button", { name: "Wrong passage" })).toBeInTheDocument();
    expect(row("Another service").getByRole("button", { name: "Place" })).toBeInTheDocument();
    expect(rows().getAllByText(/Service|service/).length).toBeGreaterThanOrEqual(2);
    expect(asked).toHaveLength(1);
    // And the note it made opens in the reader.
    expect(screen.getByRole("link", { name: "Psalms 23" })).toHaveAttribute(
      "href",
      "/read?book=PSA&chapter=23",
    );
  });

  it("moves the tally when a row changes, so the bulk button keeps telling the truth", async () => {
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(page([video()], { needs_passage: 12 })),
      ),
      http.post("/api/v1/sermon-sources/videos/1/dismiss", () =>
        HttpResponse.json(video({ status: "dismissed" })),
      ),
    );
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Not a sermon" }));

    expect(await screen.findByRole("option", { name: "Needs a passage (11)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Not a sermon (1)" })).toBeInTheDocument();
  });

  it("says which reference it could not find, in the server's own words", async () => {
    server.use(
      http.get("/api/v1/sermon-sources/videos", () => HttpResponse.json(page([video()]))),
      http.post("/api/v1/sermon-sources/videos/1/place", () =>
        HttpResponse.json(
          { detail: { code: "NOT_FOUND", message: "Couldn't find reference 'Jhon 3:16'" } },
          { status: 404 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderList();

    await user.type(await screen.findByLabelText("Or type one"), "Jhon 3:16");
    await user.click(screen.getByRole("button", { name: "Place" }));

    expect(await screen.findByText(/Jhon 3:16/)).toBeInTheDocument();
    // The row is untouched — nothing was placed, so nothing about it changed.
    expect(screen.getByRole("button", { name: "Place" })).toBeInTheDocument();
  });

  it("restores a video you dismissed", async () => {
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(page([video({ status: "dismissed" })])),
      ),
      http.post("/api/v1/sermon-sources/videos/1/restore", () =>
        HttpResponse.json(video({ status: "needs_passage" })),
      ),
    );
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("button", { name: "Place" })).toBeInTheDocument();
  });

  it("offers a skipped video the chance to be noted anyway", async () => {
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(
          page([video({ status: "skipped", skip_reason: "too_short", suggestions: [] })]),
        ),
      ),
    );
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("shorter than this source's minimum")).toBeInTheDocument();
    // The box only appears once you say it was a sermon after all.
    expect(screen.queryByLabelText("Which passage was it?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Note it anyway" }));
    expect(screen.getByLabelText("Which passage was it?")).toBeInTheDocument();
  });

  it("asks before taking back a wrong passage, and does nothing if you back out", async () => {
    let reopened = 0;
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(
          page([
            video({
              status: "placed",
              placed_by: "title",
              notes: [
                { id: 11, reference: "John 6-25", book_usfm: "JHN", start_chapter: 6 },
                { id: 12, reference: "Psalms 23", book_usfm: "PSA", start_chapter: 23 },
              ],
            }),
          ]),
        ),
      ),
      http.post("/api/v1/sermon-sources/videos/1/reopen", () => {
        reopened += 1;
        return HttpResponse.json(video({ status: "needs_passage" }));
      }),
    );
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Wrong passage" }));
    // It says how many notes are about to go, because two is a different decision from one.
    expect(screen.getByText(/these 2 notes/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(reopened).toBe(0);

    await user.click(screen.getByRole("button", { name: "Wrong passage" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await screen.findByRole("button", { name: "Place" });
    expect(reopened).toBe(1);
  });

  it("offers the bulk dismiss only once the list is narrowed, and only for what it can take", async () => {
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(page([video()], { needs_passage: 312, skipped: 4, placed: 60 })),
      ),
    );
    const user = userEvent.setup();
    renderList();

    // Unnarrowed, there is nothing to press: "dismiss everything" is not an offer songbird makes.
    await screen.findByText("Livestream Sunday Worship Service - Mar. 15 2026");
    expect(screen.queryByRole("button", { name: /Dismiss all/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by source"), "1");
    // 312 + 4 — never the 60 placed rows, which have notes behind them.
    expect(await screen.findByRole("button", { name: "Dismiss all 316 matching" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by state"), "placed");
    expect(screen.queryByRole("button", { name: /Dismiss all/ })).not.toBeInTheDocument();
  });

  it("states the count and the filter before sweeping, and sends the same filter it showed", async () => {
    let sent: unknown = null;
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(page([video()], { needs_passage: 312 })),
      ),
      http.post("/api/v1/sermon-sources/videos/dismiss-matching", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ dismissed: 312 });
      }),
    );
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Livestream Sunday Worship Service - Mar. 15 2026");
    await user.selectOptions(screen.getByLabelText("Filter by source"), "1");
    await user.type(screen.getByLabelText("Published on or before"), "2024-12-31");
    await user.click(await screen.findByRole("button", { name: /Dismiss all/ }));

    // The number alone is not something anyone can check, so the confirm says the filter too.
    const dialog = within(screen.getByRole("dialog"));
    expect(
      dialog.getByText("Mark 312 videos from Majestic View, up to 2024-12-31 as not a sermon?"),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Dismiss 312" }));

    expect(await screen.findByText("Marked 312 videos as not a sermon.")).toBeInTheDocument();
    expect(sent).toEqual({ source_id: "1", published_before: "2024-12-31" });
  });

  it("sweeps nothing if you close the confirm", async () => {
    let swept = 0;
    server.use(
      http.get("/api/v1/sermon-sources/videos", () =>
        HttpResponse.json(page([video()], { needs_passage: 9 })),
      ),
      http.post("/api/v1/sermon-sources/videos/dismiss-matching", () => {
        swept += 1;
        return HttpResponse.json({ dismissed: 9 });
      }),
    );
    const user = userEvent.setup();
    renderList();

    await screen.findByText("Livestream Sunday Worship Service - Mar. 15 2026");
    await user.selectOptions(screen.getByLabelText("Filter by source"), "1");
    await user.click(await screen.findByRole("button", { name: /Dismiss all/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(swept).toBe(0);
  });

  it("wraps its chips and its controls, because this is a phone screen too", () => {
    // jsdom has no layout, so this pins the decision rather than the pixels: the chips and the
    // action row are wrapping containers and the title can break, which is what keeps a
    // hundred-character title and five suggestions inside a 390px card. The real check is the
    // Playwright pass at phone width.
    server.use(
      http.get("/api/v1/sermon-sources/videos", () => HttpResponse.json(page([video()]))),
    );
    renderList();

    return screen.findByRole("list", { name: "Possible passages" }).then((chips) => {
      expect(chips.className).toContain("flex-wrap");
      const row = screen.getByRole("button", { name: "Place" }).parentElement;
      expect(row?.className).toContain("flex-wrap");
      expect(screen.getByText(video().title).className).toContain("break-words");
    });
  });
});
