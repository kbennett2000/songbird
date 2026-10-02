import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VerseText } from "@/components/VerseText";
import type { ShownNote } from "@/lib/borrowedNotes";
import { noteLook, noteSourceOf } from "@/lib/noteLooks";
import type { TranslatorNote } from "@/schemas";

const VERSE = "For this is the way God loved the world: he gave his one and only Son";

// Reading NET, with EMB's notes borrowed: the reader's own wiring, in miniature.
const lookOf = (n: ShownNote) => noteLook(noteSourceOf(n, "NET"), ["EMB", "NET"]);

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
    render(<VerseText text={VERSE} notes={[n]} onOpenNote={onOpenNote} lookOf={lookOf} />);

    const marker = screen.getByRole("button", { name: "Translator's note 1" });
    expect(marker).toHaveTextContent("1");

    await userEvent.click(marker);
    expect(onOpenNote).toHaveBeenCalledTimes(1);
    // The opened note is the exact one, anchored to the tapped marker.
    expect(onOpenNote).toHaveBeenCalledWith(n, marker);
  });

  it("renders plain text with no marker affordance when there are no notes", () => {
    render(<VerseText text={VERSE} notes={[]} onOpenNote={vi.fn()} lookOf={lookOf} />);
    expect(screen.getByText(VERSE)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("labels a note borrowed from NET as such", () => {
    const borrowed = { ...note({ char_offset: 8 }), borrowed: { from: "NET", phrase: "For this", rank: 0 } };
    render(<VerseText text={VERSE} notes={[borrowed]} onOpenNote={vi.fn()} lookOf={lookOf} />);
    expect(
      screen.getByRole("button", { name: "Translator's note 1 (from NET)" }),
    ).toBeInTheDocument();
  });

  it("names a marker by the source's own label when the note has one", () => {
    render(
      <VerseText
        text={VERSE}
        notes={[note({ char_offset: 8, label: "Study Note" })]}
        onOpenNote={vi.fn()} lookOf={lookOf}
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
      <VerseText text={VERSE} notes={[textual, article]} onOpenNote={vi.fn()} lookOf={lookOf} />,
    );
    for (let i = 0; i < 4; i++) {
      rerender(<VerseText text={VERSE} notes={[other, textual, article]} onOpenNote={vi.fn()} lookOf={lookOf} />);
      rerender(<VerseText text={VERSE} notes={[textual, article]} onOpenNote={vi.fn()} lookOf={lookOf} />);
    }
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Textual Note/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^A Made-Up Article/ })).toHaveLength(1);
  });
});

describe("VerseText — markers side by side", () => {
  it("puts a gap before a marker that follows another, and nowhere else", () => {
    // Two notes at one spot, then one after words: "loved¹ ²" … "world³", never "loved¹²".
    const notes = [
      note({ char_offset: 30, ordinal: 1 }),
      note({ char_offset: 30, ordinal: 2 }),
      note({ char_offset: 39, ordinal: 3 }),
    ];
    render(<VerseText text={VERSE} notes={notes} onOpenNote={vi.fn()} lookOf={lookOf} />);
    const [first, second, third] = screen.getAllByRole("button");
    expect(first).toHaveTextContent("1");
    expect(second).toHaveTextContent("2");
    expect(first).not.toHaveClass("ml-[0.3em]");
    expect(second).toHaveClass("ml-[0.3em]");
    // A marker after words keeps today's place.
    expect(third).not.toHaveClass("ml-[0.3em]");
    // The gap is outside the marker: its look (colour, size, shape) is untouched.
    expect(second).toHaveClass("align-super", "text-[0.7em]", "text-violet-600");
  });
});

describe("VerseText — each Bible's look", () => {
  it("gives a note read here and one borrowed from another Bible different looks", () => {
    const own = note({ char_offset: 8, ordinal: 1, label: "Own Note" });
    const borrowed = {
      ...note({ char_offset: 19, ordinal: 1, label: "Borrowed Note" }),
      borrowed: { from: "EMB", phrase: "the way", rank: 0 },
    };
    render(<VerseText text={VERSE} notes={[own, borrowed]} onOpenNote={vi.fn()} lookOf={lookOf} />);
    const ownMarker = screen.getByRole("button", { name: "Own Note 1" });
    const embMarker = screen.getByRole("button", { name: "Borrowed Note 2 (from EMB)" });
    // NET (read here) keeps today's plain violet number; EMB's is a rose number in a square.
    expect(ownMarker).toHaveAttribute("data-note-look", "violet");
    expect(ownMarker).toHaveClass("text-violet-600");
    expect(ownMarker.firstElementChild).toBeNull(); // a plain number, as before
    expect(embMarker).toHaveAttribute("data-note-look", "rose-square");
    expect(embMarker).toHaveClass("text-rose-700");
    expect(embMarker.firstElementChild).toHaveClass("ring-1", "rounded-sm");
    expect(embMarker).toHaveTextContent("2");
    // The button itself (its size, position and tap target) is the same whatever the look.
    for (const m of [ownMarker, embMarker]) {
      expect(m).toHaveClass("align-super", "text-[0.7em]");
      expect(m).not.toHaveClass("leading-none");
    }
  });
});
