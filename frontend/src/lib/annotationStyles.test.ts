import { describe, expect, it } from "vitest";

import * as styles from "@/lib/annotationStyles";

/**
 * The #60 dark-mode sweep was a regex that only rewrote utilities which already carried a colour,
 * so several accents shipped with no dark variant at all and the highlight got a colour nobody
 * chose (#122). These tests guard the rule that sweep broke, not the particular colours it picked:
 * every light utility in the accent set must have a dark counterpart at the same variant.
 */

/** `hover:text-amber-800` → variant `hover:`, property `text`. `bg-amber-100` → ``, `bg`. */
function parse(token: string): { variant: string; property: string } | null {
  const dark = token.startsWith("dark:");
  const rest = dark ? token.slice("dark:".length) : token;
  const parts = rest.split(":");
  const bare = parts.pop() ?? "";
  const property = bare.startsWith("bg-") ? "bg" : bare.startsWith("text-") ? "text" : "";
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

  it("keeps the dark verse wash as restrained as the light one", () => {
    // Light sits at 1.07:1 against the page. amber-900 landed at 1.96:1 — the bug in #122.
    // amber-950/90 computes to #401a07, 1.16:1. Pinned so a future sweep can't silently flip it.
    expect(styles.VERSE_HIGHLIGHT).toContain("dark:bg-amber-950/90");
    expect(styles.VERSE_HIGHLIGHT).not.toContain("amber-900");
  });
});
