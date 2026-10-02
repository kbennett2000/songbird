import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotePopover } from "@/components/NotePopover";
import type { ShownNote } from "@/lib/borrowedNotes";
import { noteLook, noteSourceOf } from "@/lib/noteLooks";
import type { TranslatorNote } from "@/schemas";

function note(overrides: Partial<TranslatorNote> = {}): TranslatorNote {
  return {
    book: "JHN",
    chapter: 3,
    verse: 16,
    reference: "John 3:16",
    type: "tn",
    text: "Or 'this is how much God loved the world.'",
    char_offset: 8,
    marker: "23",
    ordinal: 1,
    cross_references: [],
    ...overrides,
  };
}

/** Opened as the reader opens it, reading `reading` with EMB and NET as the notes Bibles. */
function renderPopover(
  n: ShownNote,
  onJump = vi.fn(),
  onClose = vi.fn(),
  reading = "NET",
  onOpenChart = vi.fn(),
) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const source = noteSourceOf(n, reading);
  render(
    <NotePopover
      note={n}
      source={source}
      look={noteLook(source, ["EMB", "NET"])}
      anchor={anchor}
      onJump={onJump}
      onClose={onClose}
      onOpenChart={onOpenChart}
    />,
  );
  return { onJump, onClose, onOpenChart, anchor };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NotePopover", () => {
  it("shows the note type label and its text (Greek/Hebrew intact)", () => {
    renderPopover(note({ type: "sn", text: "A study note: ἀγάπη / אַהֲבָה." }));
    expect(screen.getByText("Study note")).toBeInTheDocument();
    expect(screen.getByText("A study note: ἀγάπη / אַהֲבָה.")).toBeInTheDocument();
  });

  it("labels a null-type note as a plain footnote", () => {
    renderPopover(note({ type: null }));
    expect(screen.getByText("Footnote")).toBeInTheDocument();
  });

  it("jumps via canonical coords when a cross-ref is tapped (reuses navigation, no re-parsing)", async () => {
    const { onJump } = renderPopover(
      note({
        cross_references: [
          {
            to_book: "ROM",
            to_chapter: 5,
            to_verse_start: 8,
            to_verse_end: null,
            reference: "Romans 5:8",
          },
        ],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Romans 5:8/ }));
    // Canonical-coordinate bridge: the popover hands navigation the exact USFM anchor.
    expect(onJump).toHaveBeenCalledWith("ROM", 5, 8);
  });

  it("closes on Escape", async () => {
    const { onClose } = renderPopover(note());
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open while the note's own content is scrolled, but closes on an outside scroll", () => {
    const { onClose } = renderPopover(note({ text: "A very long text-critical note…" }));
    // Scrolling inside the popover (a long note) must NOT dismiss it.
    fireEvent.scroll(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // Scrolling the surrounding page/reader does dismiss it (so it can't drift from its anchor).
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says where a borrowed note came from and quotes the source's words it's about", () => {
    renderPopover({
      ...note(),
      borrowed: { from: "NET", phrase: "…be subject to rulers and", rank: 0 },
    });
    expect(screen.getByText(/From NET/)).toHaveTextContent(
      "From NET · NET reads “…be subject to rulers and”",
    );
  });

  it("names any source by its code, the one on its checkbox", () => {
    renderPopover({
      ...note({ label: "Textual Note" }),
      borrowed: { from: "EMB", phrase: "made-up words", rank: 1 },
    });
    expect(screen.getByText(/From EMB/)).toHaveTextContent("From EMB · EMB reads “made-up words”");
    expect(screen.getByText("Textual Note")).toBeInTheDocument();
  });

  it("shows only the source for a borrowed verse-level note (no phrase)", () => {
    renderPopover({ ...note(), borrowed: { from: "NET", phrase: "", rank: 0 } });
    expect(screen.getByText("From NET")).toBeInTheDocument();
    expect(screen.queryByText(/NET reads/)).not.toBeInTheDocument();
  });

  it("shows no source line for the translation's own note", () => {
    renderPopover(note());
    expect(screen.queryByText(/^From /)).not.toBeInTheDocument();
  });

  // --- Concord v8's fields (a study Bible's notes). Made-up text only. ---

  it("shows the source's own label over the type label", () => {
    renderPopover(note({ type: "sn", label: "Textual Note" }));
    expect(screen.getByText("Textual Note")).toBeInTheDocument();
    expect(screen.queryByText("Study note")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Textual Note — John 3:16" })).toBeInTheDocument();
  });

  it("shows the title as a heading and what the note covers under it", () => {
    renderPopover(
      note({
        title: "A made-up heading",
        passages: [
          { start_chapter: 3, start_verse: 16, end_chapter: 3, end_verse: 21, reference: "John 3:16-21" },
          { start_chapter: 5, start_verse: 1, end_chapter: 5, end_verse: 9, reference: "John 5:1-9" },
        ],
      }),
    );
    expect(screen.getByRole("heading", { name: "A made-up heading" })).toBeInTheDocument();
    expect(screen.getByText("Covers John 3:16-21; John 5:1-9")).toBeInTheDocument();
  });

  it("renders a Markdown note as Markdown, with ref: links that jump", async () => {
    const { onJump } = renderPopover(
      note({
        text: "A *made-up* note.\n\n- first\n- second\n\nSee [chapter 4](ref:JHN.4).",
        text_format: "markdown",
      }),
    );
    expect(screen.getByText("made-up").tagName).toBe("EM");
    expect(screen.getByRole("dialog").querySelectorAll("li")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "chapter 4" }));
    expect(onJump).toHaveBeenCalledWith("JHN", 4, null);
  });

  it("keeps a plain-text note exactly as before — Markdown characters and all", () => {
    renderPopover(note({ text: "Plain *text*, [not a link](ref:JHN.4)." }));
    expect(screen.getByText("Plain *text*, [not a link](ref:JHN.4).")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "not a link" })).not.toBeInTheDocument();
  });

  it("an older Concord's note (no v8 fields) shows no heading and no 'Covers' line", () => {
    renderPopover(note());
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Covers/)).not.toBeInTheDocument();
  });

  it("keeps the kind and Close pinned while a long note scrolls", () => {
    renderPopover(note({ label: "Study Note", text: "A long made-up note. ".repeat(200) }));
    // The kind sits beside the Bible's code in the pinned row.
    const header = screen.getByText("Study Note").closest(".sticky")!;
    expect(header).not.toBeNull();
    expect(header).toContainElement(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toHaveClass("overflow-y-auto");
  });

  it("names the Bible of a note read here, in that Bible's look, in the pinned row", () => {
    renderPopover(note({ type: "sn" }), vi.fn(), vi.fn(), "EMB");
    const chip = screen.getByText("EMB");
    expect(chip).toHaveAttribute("data-note-look", "rose-square");
    expect(chip.closest(".sticky")).not.toBeNull();
    expect(screen.getByText("Study note")).toHaveClass("text-rose-700");
  });

  it("names the Bible of a borrowed note in that Bible's look, not the one being read", () => {
    renderPopover(
      { ...note({ type: "sn" }), borrowed: { from: "NET", phrase: "made-up words", rank: 0 } },
      vi.fn(),
      vi.fn(),
      "EMB",
    );
    expect(screen.getByText("NET")).toHaveAttribute("data-note-look", "violet");
    expect(screen.getByText("Study note")).toHaveClass("text-violet-700");
  });

  // A chart, as a study Bible sends one: made-up title, name and reference.
  const chart = (): TranslatorNote =>
    note({
      type: "chart",
      label: "Chart",
      title: "A made-up chart",
      text: "[Genesis 12:10-20](ref:GEN.12.10-20)",
      text_format: "markdown",
      passages: [
        { start_chapter: 12, start_verse: 10, end_chapter: 12, end_verse: 20, reference: "Genesis 12:10-20" },
      ],
      image: "chart-99.png",
    });

  it("shows a chart's picture from the Bible being read, under its title, and opens it larger", async () => {
    const { onOpenChart } = renderPopover(chart(), vi.fn(), vi.fn(), "EMB");
    const img = screen.getByAltText("Chart: A made-up chart");
    expect(img).toHaveAttribute("src", "/api/v1/translations/EMB/assets/chart-99.png");
    // Title and what it covers first, then the picture, then the link to the passage.
    const dialog = screen.getByRole("dialog");
    const order = [
      within(dialog).getByRole("heading", { name: "A made-up chart" }),
      within(dialog).getByText("Covers Genesis 12:10-20"),
      img,
      within(dialog).getByRole("button", { name: "Genesis 12:10-20" }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    fireEvent.load(img);
    await userEvent.click(screen.getByRole("button", { name: "Open the chart larger: A made-up chart" }));
    expect(onOpenChart).toHaveBeenCalledOnce();
  });

  it("takes a borrowed chart's picture from the Bible it came from, not the one being read", () => {
    renderPopover({ ...chart(), borrowed: { from: "EMB", phrase: "", rank: 0 } }, vi.fn(), vi.fn(), "KJV");
    expect(screen.getByAltText("Chart: A made-up chart")).toHaveAttribute(
      "src",
      "/api/v1/translations/EMB/assets/chart-99.png",
    );
  });

  it("shows no picture for a note without one, as from an older Concord", () => {
    renderPopover(note({ type: "chart", label: "Chart", title: "A made-up chart" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector("[data-chart-picture]")).toBeNull();
  });

  it("names a chart that has no label of its own a Chart", () => {
    renderPopover(note({ type: "chart" }));
    expect(screen.getByText("Chart")).toBeInTheDocument();
  });
});
