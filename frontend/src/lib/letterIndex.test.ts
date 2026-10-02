import { describe, expect, it } from "vitest";

import { parseLetterIndex } from "@/lib/letterIndex";

// Made-up headings only — never a real index's topics. Each letter's word is invented.
const topic = (letter: string, n: number) => `${letter}ozzwick ${n}`;

/** A made-up index: `##` headings, each over one made-up entry with a `ref:` link. */
function index(headings: string[], before = ""): string {
  return [
    before,
    ...headings.map((h) => `## ${h}\n\n- Made-up statement ([Made-up 1:1](ref:GEN.1.1)).`),
  ].join("\n\n");
}

// 24 headings over eight letters: A×5, B×3, D×4, E×2, G×3, K×1, S×4, Y×2.
const RUNS: [string, number][] = [
  ["A", 5],
  ["B", 3],
  ["D", 4],
  ["E", 2],
  ["G", 3],
  ["K", 1],
  ["S", 4],
  ["Y", 2],
];
const HEADINGS = RUNS.flatMap(([letter, count]) =>
  Array.from({ length: count }, (_, n) => topic(letter, n + 1)),
);

describe("parseLetterIndex", () => {
  it("offers only the letters the headings start with, each at its first heading", () => {
    expect(parseLetterIndex(index(HEADINGS))).toEqual({
      letters: [
        { letter: "A", heading: 0 },
        { letter: "B", heading: 5 },
        { letter: "D", heading: 8 },
        { letter: "E", heading: 12 },
        { letter: "G", heading: 14 },
        { letter: "K", heading: 17 },
        { letter: "S", heading: 18 },
        { letter: "Y", heading: 22 },
      ],
    });
  });

  it("reads past case, accents, an opening quote and emphasis", () => {
    const headings = [...HEADINGS];
    headings[1] = "“aozzwick”";
    headings[5] = "**Bozzwick**";
    headings[12] = "Éozzwick";
    headings[13] = "*(ezzwick)*";
    expect(
      parseLetterIndex(index(headings))
        ?.letters.map((l) => l.letter)
        .join(""),
    ).toBe("ABDEGKSY");
  });

  it("ignores words before the first heading, a # title and smaller headings", () => {
    const withSubheadings = index(HEADINGS).replace(
      "## Dozzwick 1",
      "### Made-up subheading\n\n## Dozzwick 1",
    );
    const parsed = parseLetterIndex(
      `# Made-up index\n\nMade-up words first.\n\n${withSubheadings}`,
    );
    expect(parsed?.letters.find((l) => l.letter === "D")).toEqual({ letter: "D", heading: 8 });
  });

  it("isn't an index with fewer than 20 headings", () => {
    expect(parseLetterIndex(index(HEADINGS.slice(0, 20)))).not.toBeNull();
    expect(parseLetterIndex(index(HEADINGS.slice(0, 19)))).toBeNull();
  });

  it("isn't an index when a first letter goes back", () => {
    const headings = [...HEADINGS];
    headings[10] = topic("B", 9);
    expect(parseLetterIndex(index(headings))).toBeNull();
  });

  it("isn't an index when a heading starts with a digit", () => {
    const headings = [...HEADINGS];
    headings[0] = "1 Aozzwick";
    expect(parseLetterIndex(index(headings))).toBeNull();
  });

  it("isn't an index over fewer than five letters", () => {
    const series = RUNS.slice(0, 4).flatMap(([letter]) =>
      Array.from({ length: 5 }, (_, n) => topic(letter, n + 1)),
    );
    expect(series).toHaveLength(20);
    expect(parseLetterIndex(index(series))).toBeNull();
  });

  it("isn't a reading plan, or a document of a few sections", () => {
    const days = [
      ...Array.from({ length: 15 }, (_, n) => `January ${n + 1}`),
      ...Array.from({ length: 10 }, (_, n) => `February ${n + 1}`),
    ];
    expect(parseLetterIndex(index(days))).toBeNull();
    expect(parseLetterIndex(index(["Aozzwick", "Bozzwick", "Cozzwick"]))).toBeNull();
    expect(parseLetterIndex("Made-up words.")).toBeNull();
  });
});
