import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotePopover } from "@/components/NotePopover";
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

function renderPopover(n: TranslatorNote, onJump = vi.fn(), onClose = vi.fn()) {
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
});
