import { describe, expect, it } from "vitest";

import { borrowNotes, noteSources, placeBorrowedNote, words } from "@/lib/borrowedNotes";
import type { TranslatorNote } from "@/schemas";

// Titus 3:1 — NET's note on "and" should land on the ESV's "and" (the feature's motivating case).
const NET_TIT_3_1 =
  "Remind them to be subject to rulers and authorities, to be obedient, to be ready for every good work.";
const ESV_TIT_3_1 =
  "Remind them to be submissive to rulers and authorities, to be obedient, to be ready for every good work,";

function note(overrides: Partial<TranslatorNote> = {}): TranslatorNote {
  return {
    book: "TIT",
    chapter: 3,
    verse: 1,
    reference: "Titus 3:1",
    type: "tn",
    text: "a note",
    char_offset: 0,
    marker: null,
    ordinal: 0,
    cross_references: [],
    ...overrides,
  };
}

/** The offset just after the first occurrence of `phrase` in `text`. */
function after(text: string, phrase: string): number {
  const i = text.indexOf(phrase);
  if (i < 0) throw new Error(`"${phrase}" not in "${text}"`);
  return i + phrase.length;
}

describe("words", () => {
  it("lower-cases, drops punctuation, and keeps inner apostrophes (curly → straight)", () => {
    expect(words("The Lord’s house, O God!").map((w) => w.norm)).toEqual([
      "the",
      "lord's",
      "house",
      "o",
      "god",
    ]);
  });

  it("records each word's position in the original text", () => {
    const [, second] = words("In the beginning");
    expect(second).toEqual({ norm: "the", start: 3, end: 6 });
  });
});

describe("placeBorrowedNote", () => {
  it("places NET's Titus 3:1 note on the ESV's 'and'", () => {
    const placed = placeBorrowedNote(
      note({ char_offset: after(NET_TIT_3_1, "rulers and") }),
      NET_TIT_3_1,
      ESV_TIT_3_1,
    );
    expect(placed.char_offset).toBe(after(ESV_TIT_3_1, "rulers and"));
    expect(placed.borrowed).toEqual({ from: "NET", phrase: "…to be subject to rulers and", rank: 0 });
  });

  it("keeps the rest of the note intact", () => {
    const n = note({
      char_offset: after(NET_TIT_3_1, "rulers and"),
      text: "Grk “and”.",
      ordinal: 4,
    });
    const placed = placeBorrowedNote(n, NET_TIT_3_1, ESV_TIT_3_1);
    expect(placed).toMatchObject({ text: "Grk “and”.", ordinal: 4, verse: 1, type: "tn" });
  });

  it("ignores capitals and punctuation when matching", () => {
    const source = "In the beginning God created the heavens";
    const target = "In the beginning, god created the heavens";
    const placed = placeBorrowedNote(note({ char_offset: after(source, "God") }), source, target);
    expect(placed.char_offset).toBe(after(target, "god"));
  });

  it("matches a curly apostrophe against a straight one", () => {
    const source = "to the Lord's house";
    const target = "into the Lord’s house";
    const placed = placeBorrowedNote(
      note({ char_offset: after(source, "Lord's") }),
      source,
      target,
    );
    expect(placed.char_offset).toBe(after(target, "Lord’s"));
  });

  it("falls back to fewer words when the longer phrase isn't there", () => {
    // "is the way" and "the way" aren't in the target, but "way" is — exactly once.
    const source = "For this is the way God loved the world";
    const target = "For in this way God loved the world";
    const placed = placeBorrowedNote(note({ char_offset: after(source, "way") }), source, target);
    expect(placed.char_offset).toBe(after(target, "way"));
  });

  it("puts the note at the end of the verse when the match is ambiguous", () => {
    // Only "and" survives, and it appears twice in the target — no confident spot.
    const source = "Jesus wept and";
    const target = "Jesus cried and prayed and sang";
    const placed = placeBorrowedNote(note({ char_offset: source.length }), source, target);
    expect(placed.char_offset).toBe(target.length);
  });

  it("puts the note at the end of the verse when the words aren't found", () => {
    const source = "For this is the way God loved the world";
    const target = "For God so loved the world";
    const placed = placeBorrowedNote(note({ char_offset: after(source, "way") }), source, target);
    expect(placed.char_offset).toBe(target.length);
  });

  it("keeps a verse-level note (offset 0) at the start, with no phrase", () => {
    const placed = placeBorrowedNote(note({ char_offset: 0 }), NET_TIT_3_1, ESV_TIT_3_1);
    expect(placed.char_offset).toBe(0);
    expect(placed.borrowed).toEqual({ from: "NET", phrase: "", rank: 0 });
  });

  it("quotes a short phrase without a leading ellipsis", () => {
    const source = "Remind them to be subject";
    const placed = placeBorrowedNote(note({ char_offset: source.length }), source, "anything");
    expect(placed.borrowed?.phrase).toBe("Remind them to be subject");
  });
});

describe("borrowNotes", () => {
  it("groups placed notes by verse and drops notes for verses the target lacks", () => {
    const notes = [
      note({ verse: 1, char_offset: after(NET_TIT_3_1, "rulers and"), ordinal: 0 }),
      note({ verse: 1, char_offset: after(NET_TIT_3_1, "obedient"), ordinal: 1 }),
      note({ verse: 2, char_offset: 3, ordinal: 0 }), // target has verse 2 but no text
      note({ verse: 3, char_offset: 3, ordinal: 0 }), // target has no verse 3 at all
    ];
    const byVerse = borrowNotes(
      notes,
      [
        { verse: 1, text: NET_TIT_3_1 },
        { verse: 2, text: "to slander no one" },
        { verse: 3, text: "For we too" },
      ],
      [
        { verse: 1, text: ESV_TIT_3_1 },
        { verse: 2, text: null },
      ],
    );
    expect([...byVerse.keys()]).toEqual([1]);
    expect(byVerse.get(1)?.map((n) => n.char_offset)).toEqual([
      after(ESV_TIT_3_1, "rulers and"),
      after(ESV_TIT_3_1, "obedient"),
    ]);
    expect(byVerse.get(1)?.every((n) => n.borrowed?.from === "NET")).toBe(true);
  });
});

describe("borrowNotes from any source", () => {
  it("tags each placed note with its source and that source's checkbox rank", () => {
    const placed = borrowNotes(
      [note({ verse: 1, char_offset: 0 }), note({ verse: 1, char_offset: after(NET_TIT_3_1, "rulers and") })],
      [{ verse: 1, text: NET_TIT_3_1 }],
      [{ verse: 1, text: ESV_TIT_3_1 }],
      "EMB",
      1,
    );
    const notes = placed.get(1) ?? [];
    expect(notes.map((n) => n.borrowed)).toEqual([
      { from: "EMB", phrase: "", rank: 1 }, // anchored at the start of its verse: stays at the start
      { from: "EMB", phrase: "…to be subject to rulers and", rank: 1 },
    ]);
    expect(notes.map((n) => n.char_offset)).toEqual([0, after(ESV_TIT_3_1, "rulers and")]);
  });
});

describe("noteSources", () => {
  const tr = (id: string, note_count?: number | null) => ({ id, note_count });

  it("is every translation with notes, in Concord's order, when Concord counts them", () => {
    expect(noteSources([tr("EMB", 7), tr("ESV", 0), tr("NET", 58), tr("KJV", 0)])).toEqual([
      "EMB",
      "NET",
    ]);
  });

  it("drops NET when a counting Concord says it has none", () => {
    expect(noteSources([tr("NET", 0), tr("KJV", 0)])).toEqual([]);
  });

  it("falls back to NET alone against a Concord that doesn't send note_count", () => {
    expect(noteSources([tr("KJV"), tr("NET"), tr("EMB")])).toEqual(["NET"]);
    expect(noteSources([tr("KJV", null), tr("NET", null)])).toEqual(["NET"]);
  });

  it("is empty against an older Concord without NET (the stock image)", () => {
    expect(noteSources([tr("KJV"), tr("WEB")])).toEqual([]);
    expect(noteSources([])).toEqual([]);
  });
});
