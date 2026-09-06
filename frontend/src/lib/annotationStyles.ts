/**
 * The annotation accent, in one home so the reader, the compare view and the note popovers never
 * drift apart.
 *
 * They had drifted. The #60 dark-mode sweep (docs/dev-notes.md) was "a scripted single-pass regex"
 * that only rewrote utilities which already carried a colour — so the hand-copied count badges and
 * popover eyebrows kept light-mode-only colours, and the highlight itself got a mechanical
 * amber-100 → amber-900 flip that nobody chose (#122).
 *
 * Dark mirrors light's *restraint*, not its lightness. The light wash sits at 1.07:1 against the
 * page, so the dark one is tuned to 1.16:1; amber-900 had landed at 1.96:1 — twice as loud as the
 * thing it was translating, and 7× the page's brightness.
 *
 * These are colour only. The highlight's layout genuinely differs between views (a reader row is
 * already `rounded px-3`, a compare cell needs its own), so each call site keeps its own spacing.
 */

/** The wash on a verse that carries an in-scope note. Dark: #401a07, 1.16:1 against the page. */
export const VERSE_HIGHLIGHT = "bg-amber-100 dark:bg-amber-950/90";

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
