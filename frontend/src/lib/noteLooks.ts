import type { ShownNote } from "@/lib/borrowedNotes";

/**
 * Each notes Bible's own look, so NET's notes and EMB's can be told apart at a glance when both
 * are showing. A look is a colour AND a shape, never colour alone: the shape still separates them
 * in greyscale or for a colour-blind reader, and borrowed markers also name their Bible in their
 * accessible label ("Study Note 2 (from EMB)").
 *
 * The colours avoid the app's other meanings: amber is your own notes, emerald is sermons, blue is
 * verse numbers and links. Every colour reads at least 4.5:1 against the page, the cream verse
 * highlight and the popover, light and dark (measured; docs/dev-notes.md has the table).
 *
 * NET and EMB are pinned, so a new notes Bible in Concord never shifts theirs. Any other notes
 * Bible takes the next look not pinned, in Concord's order, with no code change; past the end,
 * those spare looks repeat (the note view still names the Bible). The look follows the Bible, not
 * the borrowing: EMB's notes look the same read in EMB or borrowed onto KJV.
 *
 * The shape is drawn on a span inside the marker, so the marker button keeps today's size: the
 * same tap target and the same line height as a plain violet number. An outline is a `ring` (an
 * inset box-shadow), never a `border`, which made a line 1–2px taller.
 *
 * Class strings are written out whole so Tailwind's scanner sees them.
 */
export interface NoteLook {
  /** A stable name for the look, set on markers and swatches as `data-note-look`. */
  id: string;
  /** The marker's colour, light and dark, with its hover. */
  colour: string;
  /** The shape around the marker's number, on an inner span ("" for a plain number). */
  shape: string;
  /** The kind line ("STUDY NOTE") at the top of the note view. */
  eyebrow: string;
  /** The Bible's code in the note view's header and on the Search page. */
  chip: string;
}

export const NOTE_LOOKS: readonly NoteLook[] = [
  {
    // Today's marker, unchanged: a plain violet number.
    id: "violet",
    colour:
      "text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300",
    shape: "",
    eyebrow: "text-violet-700 dark:text-violet-400",
    chip: "text-violet-700 dark:text-violet-400",
  },
  {
    id: "rose-square",
    colour: "text-rose-700 hover:text-rose-900 dark:text-rose-400 dark:hover:text-rose-300",
    shape: "rounded-sm px-[0.2em] ring-1 ring-inset ring-current",
    eyebrow: "text-rose-700 dark:text-rose-400",
    chip: "rounded-sm px-1 ring-1 ring-inset ring-current text-rose-700 dark:text-rose-400",
  },
  {
    id: "teal-circle",
    colour: "text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-200",
    shape: "rounded-full px-[0.3em] ring-1 ring-inset ring-current",
    eyebrow: "text-teal-700 dark:text-teal-300",
    chip: "rounded-full px-1.5 ring-1 ring-inset ring-current text-teal-700 dark:text-teal-300",
  },
  {
    id: "fuchsia-fill",
    colour:
      "text-fuchsia-700 hover:text-fuchsia-900 dark:text-fuchsia-300 dark:hover:text-fuchsia-200",
    shape: "rounded-sm bg-fuchsia-100 px-[0.2em] dark:bg-fuchsia-400/20",
    eyebrow: "text-fuchsia-700 dark:text-fuchsia-300",
    chip: "rounded-sm bg-fuchsia-100 px-1 text-fuchsia-700 dark:bg-fuchsia-400/20 dark:text-fuchsia-300",
  },
];

/** The Bibles whose look is fixed, by index into {@link NOTE_LOOKS}. */
const PINNED: Readonly<Record<string, number>> = { NET: 0, EMB: 1 };

const SPARE = NOTE_LOOKS.filter((_, i) => !Object.values(PINNED).includes(i));

/**
 * The look for a notes Bible. `sources` is the list of notes Bibles in Concord's order
 * (`noteSources`): a Bible that isn't pinned takes the spare look at its place among the other
 * unpinned ones. A code that isn't a known source gets today's violet.
 */
export function noteLook(code: string, sources: readonly string[]): NoteLook {
  const pinned = PINNED[code];
  if (pinned !== undefined) return NOTE_LOOKS[pinned]!;
  const place = sources.filter((s) => PINNED[s] === undefined).indexOf(code);
  return place < 0 ? NOTE_LOOKS[0]! : SPARE[place % SPARE.length]!;
}

/** The Bible a shown note came from: the source it was borrowed from, else the one being read. */
export function noteSourceOf(note: ShownNote, reading: string): string {
  return note.borrowed?.from ?? reading;
}
