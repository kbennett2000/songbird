import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotePopover } from "@/components/NotePopover";
import type { ShownNote } from "@/lib/borrowedNotes";
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

function renderPopover(n: ShownNote, onJump = vi.fn(), onClose = vi.fn()) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  render(<NotePopover note={n} anchor={anchor} onJump={onJump} onClose={onClose} />);
  return { onJump, onClose, anchor };
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
    const header = screen.getByText("Study Note").parentElement!;
    expect(header).toHaveClass("sticky");
    expect(header).toContainElement(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toHaveClass("overflow-y-auto");
  });
});
