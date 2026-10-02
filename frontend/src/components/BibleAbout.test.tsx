import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AboutPlace, BibleAbout } from "@/components/BibleAbout";
import { server } from "@/test/msw/server";

// Made-up documents only — never a real study Bible's front matter or reading plan.
const LIST = [
  { slug: "front-matter-1", kind: "front-matter", title: "Made-up copyright" },
  { slug: "front-matter-2", kind: "front-matter", title: "Made-up team" },
  { slug: "reading-plan-1", kind: "reading-plan", title: "Made-up plan" },
  { slug: "introduction-gen", kind: "book-introduction", title: "Made-up Genesis", book: "GEN" },
  { slug: "about-1", kind: "about", title: "Made-up authors" },
];

// A made-up index: 24 `##` headings over eight letters (A×5, B×3, D×4, E×2, G×3, K, S×4, Y×2), each
// heading an invented word over one made-up entry.
const INDEX_HEADINGS = (
  [
    ["A", 5],
    ["B", 3],
    ["D", 4],
    ["E", 2],
    ["G", 3],
    ["K", 1],
    ["S", 4],
    ["Y", 2],
  ] as const
).flatMap(([letter, count]) =>
  Array.from({ length: count }, (_, n) => `${letter}ozzwick ${n + 1}`),
);
const INDEXED = [...LIST, { slug: "front-matter-3", kind: "front-matter", title: "Made-up index" }];

const TEXTS: Record<string, string> = {
  "front-matter-3": INDEX_HEADINGS.map(
    (h) => `## ${h}\n\n- Made-up statement ([Made-up 1:1](ref:GEN.1.1)).`,
  ).join("\n\n"),
  "front-matter-2": [
    "## MADE-UP DIVISION",
    "*Made-up role*\\\nA. Made-up",
    "- Made-up name, *Made-up school*",
    "See [chapter 4](ref:JHN.4).",
  ].join("\n\n"),
  "reading-plan-1": [
    "## JANUARY 1",
    "- [Made-up 1:1](ref:GEN.1.1-2.3)",
    "## January 2",
    "- [Made-up 50:1](ref:GEN.50.1-26)—[Made-up 2:10](ref:EXO.1.1-2.10)\n- [Made-up song](ref:PSA.2.1-12)",
    "## FEBRUARY 1",
    "- [Made-up 9](ref:LEV.9)",
    "## JUNE 1",
    "- [Made-up 30](ref:NUM.30)",
    "## June 15",
    "- [Made-up 31](ref:NUM.31)",
  ].join("\n\n"),
  "reading-plan-2": "## Made-up week one\n\n- [Made-up](ref:GEN.1)",
};

function useDocuments({
  listed = LIST,
  failList = false,
  failDocument = false,
}: { listed?: typeof LIST; failList?: boolean; failDocument?: boolean } = {}) {
  const down = () =>
    HttpResponse.json(
      { detail: { code: "CONCORD_UNREACHABLE", message: "down" } },
      { status: 502 },
    );
  server.use(
    http.get("/api/v1/translations/:translation/documents", () =>
      failList
        ? down()
        : HttpResponse.json({
            translation: "EMB",
            total: listed.length,
            documents: listed.map((d, i) => ({ book: null, ordinal: i + 1, ...d })),
          }),
    ),
    http.get("/api/v1/translations/:translation/documents/:slug", async ({ params }) => {
      const slug = String(params.slug);
      if (failDocument) {
        // Slow enough for its loading line to be seen first.
        await delay(50);
        return down();
      }
      return HttpResponse.json({
        translation: "EMB",
        slug,
        kind: slug.replace(/-\d+$/, ""),
        title: listed.find((d) => d.slug === slug)?.title ?? "Made-up other plan",
        book: null,
        ordinal: 1,
        text: TEXTS[slug] ?? "Made-up words.",
        images: [],
      });
    }),
  );
}

function renderAbout(initialPlace?: AboutPlace) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  const onPlaceChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BibleAbout
        translation="EMB"
        name="Made-up Bible"
        backTo="Genesis 13"
        initialPlace={initialPlace}
        onPlaceChange={onPlaceChange}
        onJump={onJump}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onJump, onClose, onPlaceChange };
}

/** The view's scrolling body. */
function body(): HTMLElement {
  return document.querySelector<HTMLElement>("dialog > div[tabindex='-1']")!;
}

/** Lay the plan out so that `id` sits `top` px below the top of the page. */
function placeDay(id: string, top: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const y = this.id === id ? top : 0;
    return { top: y, bottom: y, left: 0, right: 0, width: 0, height: 0, x: 0, y } as DOMRect;
  });
}

/** Lay the page out so that the `##` heading reading `words` sits `top` px below its top. */
function placeHeading(words: string, top: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const y = this.hasAttribute("data-md-heading") && this.textContent === words ? top : 0;
    return { top: y, bottom: y, left: 0, right: 0, width: 0, height: 0, x: 0, y } as DOMRect;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BibleAbout — the list", () => {
  it("says it's loading, then lists the documents by kind under the Bible's name", async () => {
    useDocuments();
    renderAbout();
    const view = screen.getByRole("dialog", { name: "Made-up Bible" });
    expect(within(view).getByText("About EMB")).toBeInTheDocument();
    expect(
      within(view).getByText("Loading EMB’s front matter and reading plan…"),
    ).toBeInTheDocument();

    const groups = await within(view).findAllByRole("heading", { level: 3 });
    expect(groups.map((h) => h.textContent)).toEqual([
      "Front matter",
      "Reading plan",
      "About the edition",
    ]);
    expect(within(view).getByRole("button", { name: /Made-up team/ })).toBeInTheDocument();
    // A book's introduction belongs to the reader's chapters, not here.
    expect(within(view).queryByText("Made-up Genesis")).not.toBeInTheDocument();
  });

  it("says so when the Bible has none", async () => {
    useDocuments({ listed: LIST.filter((d) => d.kind === "book-introduction") });
    renderAbout();
    expect(
      await screen.findByText("EMB has no front matter, reading plan or notes on the edition."),
    ).toBeInTheDocument();
  });

  it("says when Concord couldn't be reached, and asks again", async () => {
    useDocuments({ failList: true });
    const user = userEvent.setup();
    renderAbout();
    expect(
      await screen.findByText(
        "Couldn’t load EMB’s front matter and reading plan (is Concord reachable?)",
      ),
    ).toBeInTheDocument();
    useDocuments();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Made-up team/ })).toBeInTheDocument();
  });

  it("closes by the way back at the end", async () => {
    useDocuments();
    const user = userEvent.setup();
    const { onClose } = renderAbout();
    await user.click(await screen.findByRole("button", { name: "← Back to Genesis 13" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("BibleAbout — a document", () => {
  it("opens in full, and steps back to the list by ‹, with focus on its row", async () => {
    useDocuments();
    const user = userEvent.setup();
    const { onPlaceChange } = renderAbout();
    await user.click(await screen.findByRole("button", { name: /Made-up team/ }));

    const view = screen.getByRole("dialog", { name: "Made-up team" });
    expect(within(view).getByText("Front matter · EMB")).toBeInTheDocument();
    expect(
      await within(view).findByRole("heading", { name: "MADE-UP DIVISION", level: 3 }),
    ).toBeVisible();
    // A role over its name, each on a line of its own.
    expect(view.querySelectorAll("[data-poetry-line]")).toHaveLength(2);
    expect(onPlaceChange).toHaveBeenLastCalledWith({
      slug: "front-matter-2",
      month: null,
      day: null,
    });

    await user.click(within(view).getByRole("button", { name: "Back to About EMB" }));
    const row = await screen.findByRole("button", { name: /Made-up team/ });
    expect(screen.getByRole("dialog", { name: "Made-up Bible" })).toBeInTheDocument();
    expect(document.activeElement).toBe(row);
  });

  it("steps back by Escape or Android's Back, and only closes from the list", async () => {
    useDocuments();
    const user = userEvent.setup();
    renderAbout();
    await user.click(await screen.findByRole("button", { name: /Made-up copyright/ }));
    const dialog = screen.getByRole("dialog", { name: "Made-up copyright" });

    const inDocument = new Event("cancel", { cancelable: true });
    fireEvent(dialog, inDocument);
    expect(inDocument.defaultPrevented).toBe(true);
    expect(await screen.findByRole("dialog", { name: "Made-up Bible" })).toBeInTheDocument();

    const onList = new Event("cancel", { cancelable: true });
    fireEvent(dialog, onList);
    expect(onList.defaultPrevented).toBe(false);
  });

  it("steps back on Escape's key press every time, before the browser makes it a close", async () => {
    useDocuments();
    const user = userEvent.setup();
    renderAbout();
    // Chrome lets a page refuse a dialog's close only twice; the key press has no such limit.
    for (const name of [/Made-up copyright/, /Made-up team/, /Made-up copyright/]) {
      await user.click(await screen.findByRole("button", { name }));
      const dialog = screen.getByRole("dialog", { name: /Made-up (copyright|team)/ });
      expect(fireEvent.keyDown(dialog.querySelector("[tabindex='-1']")!, { key: "Escape" })).toBe(
        false,
      );
      expect(await screen.findByRole("dialog", { name: "Made-up Bible" })).toBeInTheDocument();
    }
    // On the list, the key press is left alone, so the browser closes the page.
    const list = screen.getByRole("dialog", { name: "Made-up Bible" });
    expect(fireEvent.keyDown(list, { key: "Escape" })).toBe(true);
  });

  it("jumps from a ref: link, and has both ways back at the end", async () => {
    useDocuments();
    const user = userEvent.setup();
    const { onJump, onClose } = renderAbout({ slug: "front-matter-2", month: null, day: null });
    await user.click(await screen.findByRole("button", { name: "chapter 4" }));
    expect(onJump).toHaveBeenCalledWith("JHN", 4, null);

    await user.click(screen.getByRole("button", { name: "‹ About EMB" }));
    expect(await screen.findByRole("dialog", { name: "Made-up Bible" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says when a document couldn't be loaded, and asks again", async () => {
    useDocuments({ failDocument: true });
    const user = userEvent.setup();
    renderAbout();
    await user.click(await screen.findByRole("button", { name: /Made-up copyright/ }));
    expect(await screen.findByText("Loading Made-up copyright…")).toBeInTheDocument();
    expect(
      await screen.findByText("Couldn’t load Made-up copyright (is Concord reachable?)"),
    ).toBeInTheDocument();
    useDocuments();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Made-up words.")).toBeInTheDocument();
  });
});

describe("BibleAbout — a reading plan", () => {
  function setToday(date: Date) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(date);
  }

  it("opens on today's month, scrolled to today, marked", async () => {
    setToday(new Date(2026, 0, 2, 9));
    useDocuments();
    placeDay("plan-day-1-2", 240);
    renderAbout({ slug: "reading-plan-1", month: null, day: null });

    const today = await screen.findByRole("heading", { name: "January 2 Today", level: 3 });
    expect(today.closest("section")).toHaveAttribute("aria-current", "date");
    // The book's capitals for a month's first day read as the other days do.
    expect(screen.getByRole("heading", { name: "January 1", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "February 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("2");
    expect(body().scrollTop).toBe(240);
  });

  it("goes to a month, a day in it and back to today, and steps month by month", async () => {
    setToday(new Date(2026, 0, 2, 9));
    useDocuments();
    const user = userEvent.setup();
    const { onPlaceChange } = renderAbout({ slug: "reading-plan-1", month: null, day: null });
    await screen.findByRole("heading", { name: "January 2 Today" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "6");
    expect(screen.getByRole("heading", { name: "June 1", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "January 1" })).not.toBeInTheDocument();
    expect(body().scrollTop).toBe(0);
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("");

    placeDay("plan-day-6-15", 500);
    await user.selectOptions(screen.getByRole("combobox", { name: "Day" }), "15");
    expect(body().scrollTop).toBe(500);
    expect(onPlaceChange).toHaveBeenLastCalledWith({ slug: "reading-plan-1", month: 6, day: 15 });

    await user.click(screen.getByRole("button", { name: "← February" }));
    expect(screen.getByRole("heading", { name: "February 1", level: 3 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "June →" }));
    expect(screen.getByRole("heading", { name: "June 15", level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /→/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByRole("heading", { name: "January 2 Today" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveValue("1");
  });

  it("jumps each half of a reading that crosses into the next book to its own start", async () => {
    setToday(new Date(2026, 5, 15, 9));
    useDocuments();
    const user = userEvent.setup();
    const { onJump, onPlaceChange } = renderAbout({
      slug: "reading-plan-1",
      month: 1,
      day: null,
    });
    await user.click(await screen.findByRole("button", { name: "Made-up 50:1" }));
    expect(onJump).toHaveBeenLastCalledWith("GEN", 50, 1);
    await user.click(screen.getByRole("button", { name: "Made-up 2:10" }));
    expect(onJump).toHaveBeenLastCalledWith("EXO", 1, 1);
    // Remembered, so reopening the view comes back to the day the reading was in.
    expect(onPlaceChange).toHaveBeenLastCalledWith({ slug: "reading-plan-1", month: 1, day: 2 });
  });

  it("reopens on the month and day it was left at", async () => {
    setToday(new Date(2026, 0, 2, 9));
    useDocuments();
    placeDay("plan-day-6-15", 500);
    renderAbout({ slug: "reading-plan-1", month: 6, day: 15 });
    expect(await screen.findByRole("heading", { name: "June 15", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Day" })).toHaveValue("15");
    await waitFor(() => expect(body().scrollTop).toBe(500));
  });

  it("shows a plan that isn't laid out by date as an ordinary document", async () => {
    useDocuments();
    renderAbout({ slug: "reading-plan-2", month: null, day: null });
    expect(
      await screen.findByRole("heading", { name: "Made-up week one", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Month" })).not.toBeInTheDocument();
  });
});

describe("BibleAbout — an index", () => {
  // Each test first serves the made-up index with `useDocuments({ listed: INDEXED })`.
  const openIndex = async () => {
    const user = userEvent.setup();
    const calls = renderAbout({ slug: "front-matter-3", month: null, day: null });
    const row = await screen.findByRole("navigation", { name: "Jump to a letter" });
    return { user, row, ...calls };
  };

  it("offers a row of only the letters its headings start with, above the page", async () => {
    useDocuments({ listed: INDEXED });
    const { row } = await openIndex();
    expect(screen.getByRole("dialog", { name: "Made-up index" })).toBeInTheDocument();
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["A", "B", "D", "E", "G", "K", "S", "Y"]);
    // In the header, outside the scrolling body, so it never scrolls away.
    expect(body().contains(row)).toBe(false);
  });

  it("goes to a letter's first heading, without leaving the letters", async () => {
    useDocuments({ listed: INDEXED });
    const { user, row, onPlaceChange } = await openIndex();
    expect(
      await screen.findByRole("heading", { name: "Dozzwick 1", level: 3 }),
    ).toBeInTheDocument();
    placeHeading("Dozzwick 1", 900);
    await user.click(within(row).getByRole("button", { name: "D" }));
    // 8 px of room above the heading.
    expect(body().scrollTop).toBe(900 - 8);
    placeHeading("Yozzwick 1", 2400);
    await user.click(within(row).getByRole("button", { name: "Y" }));
    expect(body().scrollTop).toBe(2400 + 892 - 8);
    expect(within(row).getByRole("button", { name: "Y" })).toHaveFocus();
    // The same document: nothing to remember.
    expect(onPlaceChange).not.toHaveBeenCalled();
  });

  it("still steps back to the list by Escape", async () => {
    useDocuments({ listed: INDEXED });
    await openIndex();
    expect(fireEvent.keyDown(body(), { key: "Escape" })).toBe(false);
    expect(await screen.findByRole("dialog", { name: "Made-up Bible" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Jump to a letter" })).not.toBeInTheDocument();
  });

  it("isn't offered on an ordinary document or a reading plan", async () => {
    useDocuments({ listed: INDEXED });
    const user = userEvent.setup();
    renderAbout({ slug: "front-matter-2", month: null, day: null });
    expect(
      await screen.findByRole("heading", { name: "MADE-UP DIVISION", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Jump to a letter" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "‹ About EMB" }));
    await user.click(await screen.findByRole("button", { name: /Made-up plan/ }));
    expect(await screen.findByRole("combobox", { name: "Month" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Jump to a letter" })).not.toBeInTheDocument();
  });
});
