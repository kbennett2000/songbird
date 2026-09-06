import { describe, expect, it } from "vitest";

import * as styles from "@/lib/annotationStyles";

/**
 * The #60 dark-mode sweep was a regex that only rewrote utilities which already carried a colour,
 * so several accents shipped with no dark variant at all and the highlight got a colour nobody
 * chose (#122). These tests guard the rule that sweep broke, not the particular colours it picked:
 * every light utility in the accent set must have a dark counterpart at the same variant.
 */

/**
 * `hover:text-amber-800` → variant `hover:`, property `text`. `bg-amber-100` → ``, `bg`.
 *
 * `border-` is recognised as well as `bg-`/`text-`. The first version of this helper knew only the
 * latter two, which left the guard blind to exactly the treatment #122 ended up shipping — a
 * border- or rule-based highlight would have satisfied the invariant vacuously, by having no
 * recognised light utility to check.
 */
const PROPERTIES = ["bg", "text", "border"] as const;

function parse(token: string): { variant: string; property: string } | null {
  const rest = token.startsWith("dark:") ? token.slice("dark:".length) : token;
  const parts = rest.split(":");
  const bare = parts.pop() ?? "";
  const property = PROPERTIES.find((p) => bare.startsWith(`${p}-`));
  if (!property) return null;
  return { variant: parts.join(":"), property };
}

const ACCENTS = Object.entries(styles);

describe("annotation accent styles (#122)", () => {
  it("exports every accent the reader, compare view and popovers share", () => {
    // A guard on the module's reason to exist: these are the strings that were hand-copied.
    expect(ACCENTS.map(([name]) => name).sort()).toEqual([
      "NOTE_COUNT_BADGE",
      "NOTE_EYEBROW",
      "NOTE_MARKER",
      "OUT_OF_SCOPE_COUNT_BADGE",
      "OUT_OF_SCOPE_MARKER",
      "SERMON_COUNT_BADGE",
      "SERMON_EYEBROW",
      "SERMON_MARKER",
      "VERSE_HIGHLIGHT",
    ]);
  });

  it.each(ACCENTS)("%s declares a dark counterpart for every light utility", (_name, value) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    const dark = new Set(
      tokens
        .filter((t) => t.startsWith("dark:"))
        .map(parse)
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => `${p.variant}|${p.property}`),
    );

    for (const token of tokens) {
      if (token.startsWith("dark:")) continue;
      const parsed = parse(token);
      if (!parsed) continue;
      // e.g. a bare `text-amber-600` needs `dark:text-*`; `hover:text-*` needs `dark:hover:text-*`.
      expect(dark, `${token} has no dark: counterpart`).toContain(
        `${parsed.variant}|${parsed.property}`,
      );
    }
  });

  it("puts no hue in the dark verse fill (#122)", () => {
    // The whole lesson of #122: a run of a dozen annotated verses stacks into one field, and any
    // warm fill at that size is a stain on the cool page. Both attempts that tinted it were
    // rejected — amber-900 at 1.96:1, then amber-950/90 at 1.16:1. The dark fill is now colourless
    // and the amber lives in a rule at the edge. Pinned so nobody re-tints it by reflex.
    expect(styles.VERSE_HIGHLIGHT).toContain("dark:bg-white/5");
    for (const rejected of ["amber-900", "amber-950"]) {
      expect(styles.VERSE_HIGHLIGHT).not.toContain(rejected);
    }
  });

  it("hangs the dark rule off a pseudo-element, never a border (#122)", () => {
    // A real `border-l` eats content box and shifts every glyph right; the pseudo-element sits in
    // the padding the row already bleeds into, so the text column does not move.
    expect(styles.VERSE_HIGHLIGHT).toContain("dark:before:absolute");
    expect(styles.VERSE_HIGHLIGHT).toContain("dark:before:bg-amber-500");
    expect(styles.VERSE_HIGHLIGHT).not.toMatch(/(^|\s)(dark:)?border-l/);
  });

  it("recognises border utilities, so a rule-based accent can't pass vacuously", () => {
    // Regression guard on parse() itself: it once knew only bg-/text-, which would have skipped
    // the very treatment #122 shipped.
    expect(parse("border-amber-400")).toEqual({ variant: "", property: "border" });
    expect(parse("dark:hover:border-amber-300")).toEqual({
      variant: "hover",
      property: "border",
    });
  });
});
