import { describe, expect, it } from "vitest";

import { NOTE_LOOKS, noteLook, noteSourceOf } from "@/lib/noteLooks";
import type { TranslatorNote } from "@/schemas";

const note: TranslatorNote = {
  book: "JHN",
  chapter: 3,
  verse: 16,
  reference: "John 3:16",
  type: "sn",
  text: "a made-up note",
  char_offset: 0,
  marker: null,
  ordinal: 1,
  cross_references: [],
};

describe("noteLook", () => {
  it("keeps NET's plain violet number and gives EMB a rose number in a square", () => {
    expect(noteLook("NET", ["EMB", "NET"]).id).toBe("violet");
    expect(noteLook("EMB", ["EMB", "NET"]).id).toBe("rose-square");
  });

  it("gives a third and a fourth notes Bible the spare looks, in Concord's order", () => {
    const sources = ["ABC", "EMB", "NET", "XYZ"];
    expect(noteLook("ABC", sources).id).toBe("teal-circle");
    expect(noteLook("XYZ", sources).id).toBe("fuchsia-fill");
  });

  it("never moves NET's or EMB's look when another Bible arrives, wherever it sorts", () => {
    for (const sources of [["EMB", "NET"], ["AAA", "EMB", "NET"], ["EMB", "MMM", "NET", "ZZZ"]]) {
      expect(noteLook("NET", sources).id).toBe("violet");
      expect(noteLook("EMB", sources).id).toBe("rose-square");
    }
  });

  it("repeats the spare looks past the end of the list", () => {
    const sources = ["A1", "A2", "A3", "EMB", "NET"];
    expect(noteLook("A3", sources).id).toBe(noteLook("A1", sources).id);
  });

  it("falls back to today's violet for a Bible that isn't a notes source", () => {
    expect(noteLook("KJV", ["EMB", "NET"]).id).toBe("violet");
    // An older Concord: NET is the only source.
    expect(noteLook("NET", ["NET"]).id).toBe("violet");
  });

  it("draws outlines as rings, never borders, so no look makes a line taller", () => {
    for (const look of NOTE_LOOKS) expect(look.shape).not.toMatch(/(^|\s)border/);
  });

  it("gives every look a different colour and a different shape", () => {
    const colour = (look: (typeof NOTE_LOOKS)[number]) =>
      /text-(\w+)-\d+/.exec(look.colour)?.[1];
    const shape = (look: (typeof NOTE_LOOKS)[number]) =>
      ["rounded-full", "ring-1", "bg-"].filter((s) => look.shape.includes(s)).join("+") || "plain";
    expect(new Set(NOTE_LOOKS.map(colour)).size).toBe(NOTE_LOOKS.length);
    expect(new Set(NOTE_LOOKS.map(shape)).size).toBe(NOTE_LOOKS.length);
  });

  it.each(NOTE_LOOKS.flatMap((l) => [
    [`${l.id} colour`, l.colour],
    [`${l.id} shape`, l.shape],
    [`${l.id} eyebrow`, l.eyebrow],
    [`${l.id} chip`, l.chip],
  ]))("%s declares a dark colour for every light colour", (_name, classes) => {
    // The same rule annotationStyles.test.ts guards: a colour with no dark: partner shipped light-
    // only once (#122). `ring-current` follows the text colour, so it needs no partner.
    const colourOf = (t: string) => /^((?:[a-z]+:)*)(bg|text|border)-[a-z]+-\d{2,3}(\/\d+)?$/.exec(t);
    const tokens = classes.split(/\s+/);
    const dark = new Set(
      tokens
        .filter((t) => t.startsWith("dark:"))
        .map((t) => colourOf(t.slice("dark:".length)))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => `${m[1]}|${m[2]}`),
    );
    for (const t of tokens.filter((t) => !t.startsWith("dark:"))) {
      const m = colourOf(t);
      if (m) expect(dark, `${t} has no dark: partner`).toContain(`${m[1]}|${m[2]}`);
    }
  });
});

describe("noteSourceOf", () => {
  it("is the Bible a note was borrowed from, else the one being read", () => {
    expect(noteSourceOf(note, "EMB")).toBe("EMB");
    expect(noteSourceOf({ ...note, borrowed: { from: "NET", phrase: "", rank: 0 } }, "EMB")).toBe(
      "NET",
    );
  });
});
