import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { dismissibleCount, patchVideo } from "@/lib/ledgerCache";
import type { SermonSourceCounts, SermonSourceVideo, SermonSourceVideosPage } from "@/schemas";

const COUNTS: SermonSourceCounts = {
  pending: 0,
  needs_passage: 10,
  placed: 2,
  skipped: 3,
  already_noted: 0,
  dismissed: 1,
};

function video(id: number, status: SermonSourceVideo["status"]): SermonSourceVideo {
  return {
    id,
    source_id: 1,
    source_title: "Majestic View",
    video_id: `vid${id}`,
    title: `Sermon ${id}`,
    published_at: "2026-09-07T04:32:29Z",
    actual_start_time: null,
    duration_seconds: 3600,
    is_live: false,
    status,
    skip_reason: null,
    placed_by: null,
    suggestions: [],
    notes: [],
    seen_at: "2026-09-07T00:00:00Z",
    decided_at: null,
  };
}

function pages(...videos: SermonSourceVideo[]): InfiniteData<SermonSourceVideosPage> {
  return {
    pages: [{ videos, total: 10, counts: { ...COUNTS } }],
    pageParams: [0],
  };
}

describe("patchVideo", () => {
  it("replaces the row that changed and leaves its neighbours alone", () => {
    const data = pages(video(1, "needs_passage"), video(2, "needs_passage"));
    const patched = patchVideo(data, { ...video(2, "placed") }, "needs_passage", "all");

    expect(patched?.pages[0]?.videos.map((v) => v.status)).toEqual(["needs_passage", "placed"]);
  });

  it("moves the tally with the row, so the filter bar's numbers stay true", () => {
    // These numbers are also what "Dismiss all N matching" promises, so a stale one is a button
    // telling a lie.
    const patched = patchVideo(
      pages(video(1, "needs_passage")),
      video(1, "placed"),
      "needs_passage",
      "all",
    );

    expect(patched?.pages[0]?.counts.needs_passage).toBe(9);
    expect(patched?.pages[0]?.counts.placed).toBe(3);
  });

  it("leaves the tallies alone when the row did not actually move", () => {
    const patched = patchVideo(
      pages(video(1, "placed")),
      { ...video(1, "placed"), title: "renamed" },
      "placed",
      "all",
    );

    expect(patched?.pages[0]?.counts).toEqual(COUNTS);
  });

  it("drops the total when a row stops matching the state you chose", () => {
    // The row stays on screen — that is the point — but the server would no longer count it, so
    // "50 of 351" would keep claiming a row that is visibly something else now.
    const patched = patchVideo(
      pages(video(1, "needs_passage")),
      video(1, "placed"),
      "needs_passage",
      "needs_passage",
    );

    expect(patched?.pages[0]?.total).toBe(9);
    expect(patched?.pages[0]?.videos).toHaveLength(1);
  });

  it("leaves the total alone when no state was chosen", () => {
    const patched = patchVideo(
      pages(video(1, "needs_passage")),
      video(1, "placed"),
      "needs_passage",
      "all",
    );

    expect(patched?.pages[0]?.total).toBe(10);
  });

  it("never shows a negative count", () => {
    const empty = {
      pages: [{ videos: [video(1, "pending")], total: 0, counts: { ...COUNTS, pending: 0 } }],
      pageParams: [0],
    };
    const patched = patchVideo(empty, video(1, "dismissed"), "pending", "all");

    expect(patched?.pages[0]?.counts.pending).toBe(0);
  });

  it("has nothing to do before the first page arrives", () => {
    expect(patchVideo(undefined, video(1, "placed"), "needs_passage", "all")).toBeUndefined();
  });
});

describe("dismissibleCount", () => {
  it("counts only what the sweep can actually take", () => {
    // Never the placed rows: those have notes behind them, and the sweep leaves them alone.
    expect(dismissibleCount(COUNTS, "all")).toBe(13);
  });

  it("counts the chosen state when the sweep can take it", () => {
    expect(dismissibleCount(COUNTS, "needs_passage")).toBe(10);
    expect(dismissibleCount(COUNTS, "skipped")).toBe(3);
  });

  it("offers nothing at all for a state the sweep cannot touch", () => {
    for (const state of ["placed", "pending", "already_noted", "dismissed"] as const) {
      expect(dismissibleCount(COUNTS, state)).toBe(0);
    }
  });
});
