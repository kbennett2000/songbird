import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VerseText } from "@/components/VerseText";
import type { TranslatorNote } from "@/schemas";

const VERSE = "For this is the way God loved the world: he gave his one and only Son";

function note(overrides: Partial<TranslatorNote> = {}): TranslatorNote {
  return {
    book: "JHN",
    chapter: 3,
    verse: 16,
    reference: "John 3:16",
    type: "tn",
    text: "a note",
    char_offset: 0,
    marker: null,
    ordinal: 1,
    cross_references: [],
    ...overrides,
  };
}

describe("VerseText", () => {
  it("renders sequential markers and opens a note with its anchor element on click", async () => {
    const onOpenNote = vi.fn();
    const n = note({ char_offset: 8 });
    render(<VerseText text={VERSE} notes={[n]} onOpenNote={onOpenNote} />);

    const marker = screen.getByRole("button", { name: "Translator's note 1" });
    expect(marker).toHaveTextContent("1");

    await userEvent.click(marker);
    expect(onOpenNote).toHaveBeenCalledTimes(1);
    // The opened note is the exact one, anchored to the tapped marker.
    expect(onOpenNote).toHaveBeenCalledWith(n, marker);
  });

  it("renders plain text with no marker affordance when there are no notes", () => {
    render(<VerseText text={VERSE} notes={[]} onOpenNote={vi.fn()} />);
    expect(screen.getByText(VERSE)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
