/**
 * The annotation accent, in one home so the reader, the compare view and the note popovers never
 * drift apart.
 *
 * They had drifted. The #60 dark-mode sweep (docs/dev-notes.md) was "a scripted single-pass regex"
 * that only rewrote utilities which already carried a colour — so the hand-copied count badges and
 * popover eyebrows kept light-mode-only colours, and the highlight itself got a mechanical
 * amber-100 → amber-900 flip that nobody chose (#122).
 *
 * The first fix for #122 got this wrong twice over and is worth recording. It kept the amber and
 * only lowered the contrast (amber-950/90, 1.16:1), on the theory that the fault was loudness
 * rather than hue — and it was verified against a chapter with *two* annotated verses, where a
 * warm tint reads as a neat accent band. In real use a chapter often has a dozen annotated verses
 * in a row. Each verse is its own block, so they stack into one unbroken field, and at that size
 * any warm fill is a stain on the cool page. Kris's verdict: "much much worse".
 *
 * So dark stops tinting the page at all. The fill becomes a colourless lift and the amber moves to
 * a rule in the gutter — identity at the edge, nothing spilled across the text. That degrades
 * gracefully to the case that broke the first attempt: a run of twelve marked verses reads as one
 * cleanly-edged block instead of a slab.
 *
 * These are colour only, with one exception noted on VERSE_HIGHLIGHT. Layout differs between views
 * (a reader row is already `rounded px-3`, a compare cell needs its own), so call sites keep their
 * own spacing.
 */

/**
 * A verse that carries an in-scope note.
 *
 * Light is unchanged: the cream wash it has always had. Dark is a colourless lift (white/5,
 * #1b2130, 1.10:1 — no hue to clash with the page) plus a 3px amber-500 rule down the left edge.
 *
 * The rule is a pseudo-element, not a `border-l`: a real border eats 3px of content box and
 * shifts every glyph right. This needs a positioned ancestor — the reader's verse `<p>` already
 * carries `relative`, and CompareView's cell has it added for this.
 */
export const VERSE_HIGHLIGHT =
  "bg-amber-100 dark:bg-white/5 " +
  "dark:before:absolute dark:before:inset-y-0 dark:before:left-0 dark:before:w-[3px] " +
  "dark:before:bg-amber-500 dark:before:content-['']";

/** The ● that opens the note. Dark amber-400 reads 9.2:1 on the wash, where amber-600 read 2.9. */
export const NOTE_MARKER =
  "text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300";

/** The "2", "3"… pill beside ● when a verse carries several notes. */
export const NOTE_COUNT_BADGE =
  "bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-100";

/** ○ — a note written for another translation. Deliberately colourless (dev-notes, slice 2). */
export const OUT_OF_SCOPE_MARKER =
  "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300";

/** The count pill beside ○, matching its deliberate greyness. */
export const OUT_OF_SCOPE_COUNT_BADGE =
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";

/** ▶ — a sermon anchored to this verse. Emerald is the sermon accent throughout. */
export const SERMON_MARKER =
  "text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300";

/** The count pill beside ▶. */
export const SERMON_COUNT_BADGE =
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-100";

/** The "NOTE" / "NOTES · n" eyebrow on a popover card. Mirrors NotePopover's violet treatment. */
export const NOTE_EYEBROW = "text-amber-700 dark:text-amber-400";

/** The "SERMON" / "SERMONS · n" eyebrow on a popover card. */
export const SERMON_EYEBROW = "text-emerald-700 dark:text-emerald-400";
