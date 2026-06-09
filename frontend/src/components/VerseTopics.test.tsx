import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { VerseTopics } from "@/components/VerseTopics";
import { server } from "@/test/msw/server";

function topic(id: string, name: string, section: string, see_also: string | null = null) {
  return { id, name, section, see_also };
}

function topicVerse(book: string, chapter: number, verse: number, text: string | null = null) {
  return { book, chapter, verse, reference: `${book} ${chapter}:${verse}`, text };
}

function renderPanel(onJump = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <VerseTopics book="JHN" chapter={3} verse={16} translation="WEB" onJump={onJump} />
    </QueryClientProvider>,
  );
  return onJump;
}

describe("VerseTopics", () => {
  it("lists a verse's topics (name + section), then drills into a topic's verses", async () => {
    server.use(
      http.get("/api/v1/verse-topics/:book/:chapter/:verse", () =>
        HttpResponse.json([topic("love", "Love", "God"), topic("faith", "Faith", "Doctrine")]),
      ),
      http.get("/api/v1/topics/:topicId/verses", ({ params }) =>
        HttpResponse.json(
          String(params.topicId) === "love"
            ? [topicVerse("ROM", 5, 8, "But God commends his love…")]
            : [],
        ),
      ),
    );
    const user = userEvent.setup();
    renderPanel();

    // Level 1: the verse's topics, each with its section as a quiet line.
    expect(await screen.findByText("Love")).toBeInTheDocument();
    expect(screen.getByText("God")).toBeInTheDocument();
    expect(screen.getByText("Faith")).toBeInTheDocument();

    // Drill into "Love" → its verses (with text).
    await user.click(screen.getByText("Love"));
    expect(await screen.findByText("ROM 5:8")).toBeInTheDocument();
    expect(screen.getByText(/But God commends/)).toBeInTheDocument();
  });

  it("jumps the reader when a topic-verse row is clicked", async () => {
    server.use(
      http.get("/api/v1/verse-topics/:book/:chapter/:verse", () =>
        HttpResponse.json([topic("love", "Love", "God")]),
      ),
      http.get("/api/v1/topics/:topicId/verses", () =>
        HttpResponse.json([topicVerse("ROM", 5, 8, "But God commends his love…")]),
      ),
    );
    const user = userEvent.setup();
    const onJump = renderPanel();

    await user.click(await screen.findByText("Love"));
    await user.click(await screen.findByText("ROM 5:8"));
    expect(onJump).toHaveBeenCalledWith("ROM", 5, 8);
  });

  it("returns to the topic list via the ← Topics back button", async () => {
    server.use(
      http.get("/api/v1/verse-topics/:book/:chapter/:verse", () =>
        HttpResponse.json([topic("love", "Love", "God")]),
      ),
      http.get("/api/v1/topics/:topicId/verses", () =>
        HttpResponse.json([topicVerse("ROM", 5, 8, "text")]),
      ),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByText("Love"));
    await screen.findByText("ROM 5:8");
    await user.click(screen.getByRole("button", { name: /← Topics/ }));
    // Back at level 1 — the topic row is shown again, the verse is gone.
    expect(await screen.findByText("God")).toBeInTheDocument();
    expect(screen.queryByText("ROM 5:8")).not.toBeInTheDocument();
  });

  it("follows a see_also redirect to the target topic's verses", async () => {
    let requestedTopicId: string | null = null;
    server.use(
      http.get("/api/v1/verse-topics/:book/:chapter/:verse", () =>
        HttpResponse.json([topic("charity", "Charity", "Virtues", "love")]),
      ),
      http.get("/api/v1/topics/:topicId/verses", ({ params }) => {
        requestedTopicId = String(params.topicId);
        return HttpResponse.json([topicVerse("ROM", 5, 8, "text")]);
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByText("Charity"));
    await screen.findByText("ROM 5:8");
    // The redirect resolves to the target id, not the redirect topic's own id.
    expect(requestedTopicId).toBe("love");
  });

  it("shows an empty message when the verse has no topics", async () => {
    server.use(http.get("/api/v1/verse-topics/:book/:chapter/:verse", () => HttpResponse.json([])));
    renderPanel();
    expect(await screen.findByText(/No topics for this verse/)).toBeInTheDocument();
  });

  it("shows an INLINE error message on an outage (not silence)", async () => {
    server.use(
      http.get("/api/v1/verse-topics/:book/:chapter/:verse", () =>
        HttpResponse.json({ detail: { code: "CONCORD_UNREACHABLE" } }, { status: 502 }),
      ),
    );
    renderPanel();
    expect(await screen.findByText(/Couldn.t load \(is Concord reachable/)).toBeInTheDocument();
  });
});
