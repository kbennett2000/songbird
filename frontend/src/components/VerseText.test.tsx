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

  it("labels a note borrowed from NET as such", () => {
    const borrowed = { ...note({ char_offset: 8 }), borrowed: { from: "NET", phrase: "For this", rank: 0 } };
    render(<VerseText text={VERSE} notes={[borrowed]} onOpenNote={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Translator's note 1 (from NET)" }),
    ).toBeInTheDocument();
  });

  it("names a marker by the source's own label when the note has one", () => {
    render(
      <VerseText
        text={VERSE}
        notes={[note({ char_offset: 8, label: "Study Note" })]}
        onOpenNote={vi.fn()}
      />,
    );
    const marker = screen.getByRole("button", { name: "Study Note 1" });
    expect(marker).toHaveAttribute("title", "Study Note");
  });
});

describe("VerseText — two notes from one source sharing an ordinal", () => {
  // Concord numbers ordinals per kind of note, so one verse can carry a textual note and an
  // article that are both ordinal 1. Borrowed onto another translation, both can land at the end
  // of the verse — one spot, one source, one ordinal. Their markers once shared a React key, and
  // every re-render (ticking another Bible on or off) left a stale copy of one behind.
  const END = VERSE.length;
  const fromEmb = (type: string, label: string) => ({
    ...note({ type, label, char_offset: END, ordinal: 1, text: label }),
    borrowed: { from: "EMB", phrase: "", rank: 0 },
  });
  const textual = fromEmb("tn", "Textual Note");
  const article = fromEmb("article", "A Made-Up Article");
  const other = {
    ...note({ char_offset: 8, ordinal: 1, text: "other" }),
    borrowed: { from: "NET", phrase: "For this", rank: 1 },
  };

  it("keeps exactly one marker each through repeated re-renders", () => {
    const { rerender } = render(
      <VerseText text={VERSE} notes={[textual, article]} onOpenNote={vi.fn()} />,
    );
    for (let i = 0; i < 4; i++) {
      rerender(<VerseText text={VERSE} notes={[other, textual, article]} onOpenNote={vi.fn()} />);
      rerender(<VerseText text={VERSE} notes={[textual, article]} onOpenNote={vi.fn()} />);
    }
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Textual Note/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^A Made-Up Article/ })).toHaveLength(1);
  });
});
