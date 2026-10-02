import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { BookIntroduction } from "@/components/BookIntroduction";
import { server } from "@/test/msw/server";

// Made-up text and pictures only — never a real study Bible's introduction.
const TEXT = [
  "## A MADE-UP HEADING",
  "Made-up words. See [chapter 4](ref:JHN.4).",
  "> A made-up line\\\n> and its answer.",
  "![A made-up caption](asset:made-up-jhn.jpg)",
  "- 1000 B.C.\\\n  **A MADE-UP EVENT**\n- 900 B.C.\\\n  **ANOTHER MADE-UP EVENT**",
].join("\n\n");

function useIntroductions({ listed = ["JHN"], failDocument = false } = {}) {
  server.use(
    http.get("/api/v1/translations/:translation/documents", () =>
      HttpResponse.json({
        translation: "EMB",
        total: listed.length,
        documents: listed.map((b, i) => ({
          slug: `introduction-${b.toLowerCase()}`,
          kind: "book-introduction",
          title: `Made-up ${b}`,
          book: b,
          ordinal: i + 1,
        })),
      }),
    ),
    http.get("/api/v1/translations/:translation/documents/:slug", () =>
      failDocument
        ? HttpResponse.json(
            { detail: { code: "CONCORD_UNREACHABLE", message: "down" } },
            { status: 502 },
          )
        : HttpResponse.json({
            translation: "EMB",
            slug: "introduction-jhn",
            kind: "book-introduction",
            title: "Made-up John",
            book: "JHN",
            ordinal: 1,
            text: TEXT,
            images: [
              { name: "made-up-jhn.jpg", media_type: "image/jpeg", width: 1024, height: 180 },
            ],
          }),
    ),
  );
}

function renderIntro(borrowed = false) {
  vi.spyOn(HTMLDialogElement.prototype, "showModal");
  const onJump = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BookIntroduction
        translation="EMB"
        borrowed={borrowed}
        book="JHN"
        bookName="John"
        backTo="John 3"
        onJump={onJump}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onJump, onClose };
}

describe("BookIntroduction", () => {
  it("says it's loading under the book's name, then shows the introduction", async () => {
    useIntroductions();
    renderIntro();
    expect(screen.getByRole("dialog", { name: "John" })).toBeInTheDocument();
    expect(screen.getByText("Loading the introduction…")).toBeInTheDocument();

    const view = await screen.findByRole("dialog", { name: "Made-up John" });
    expect(
      within(view).getByRole("heading", { name: "A MADE-UP HEADING", level: 3 }),
    ).toBeVisible();
    expect(view.querySelectorAll("blockquote [data-poetry-line]")).toHaveLength(2);
    // Two timeline entries, each a date and an event on lines of their own.
    expect(view.querySelectorAll("li > [data-poetry-line]")).toHaveLength(4);
    expect(within(view).queryByText(/From EMB/)).not.toBeInTheDocument();
  });

  it("names the Bible it came from when it isn't the one being read", async () => {
    useIntroductions();
    renderIntro(true);
    expect(await screen.findByText(/From EMB/)).toBeInTheDocument();
  });

  it("jumps the reader from a ref: link, and closes by Close or the way back", async () => {
    useIntroductions();
    const user = userEvent.setup();
    const { onJump, onClose } = renderIntro();
    await user.click(await screen.findByRole("button", { name: "chapter 4" }));
    expect(onJump).toHaveBeenCalledWith("JHN", 4, null);

    await user.click(screen.getByRole("button", { name: "← Back to John 3" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("places its picture in a frame of the picture's shape, and opens it larger", async () => {
    useIntroductions();
    const user = userEvent.setup();
    renderIntro();
    const picture = await screen.findByRole("button", {
      name: "Open the picture larger: A made-up caption",
    });
    expect(picture.closest("[data-chart-picture]")).toHaveStyle({ aspectRatio: "1024 / 180" });
    expect(picture.closest("figure")).toHaveTextContent("A made-up caption · ⤢ Open larger");
    fireEvent.load(screen.getByAltText("A made-up caption"));

    await user.click(picture);
    const viewer = await screen.findByRole("dialog", { name: "A made-up caption" });
    expect(within(viewer).getByText("Made-up John · Introduction")).toBeInTheDocument();
    // Closing the picture leaves the introduction open, with focus back on the picture.
    await user.click(within(viewer).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "A made-up caption" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "Made-up John" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(picture));
  });

  it("opens the picture from its caption too", async () => {
    useIntroductions();
    renderIntro();
    await screen.findByRole("dialog", { name: "Made-up John" });
    fireEvent.click(screen.getByText("⤢ Open larger"));
    expect(await screen.findByRole("dialog", { name: "A made-up caption" })).toBeInTheDocument();
  });

  it("says when Concord couldn't be reached, and asks again", async () => {
    useIntroductions({ failDocument: true });
    const user = userEvent.setup();
    renderIntro();
    expect(
      await screen.findByText("Couldn’t load the introduction (is Concord reachable?)"),
    ).toBeInTheDocument();
    useIntroductions();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("dialog", { name: "Made-up John" })).toBeInTheDocument();
  });

  it("says so when the Bible has no introduction to the book", async () => {
    useIntroductions({ listed: ["GEN"] });
    renderIntro();
    expect(await screen.findByText("EMB has no introduction to John.")).toBeInTheDocument();
  });
});
