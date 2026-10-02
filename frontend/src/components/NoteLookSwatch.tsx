import type { NoteLook } from "@/lib/noteLooks";

/**
 * A sample marker in a Bible's look: the key beside its name on Settings, in the reader's Notes
 * menu and on the Search page's filter. Decorative (`aria-hidden`); the Bible's code or name next
 * to it is what a screen reader hears.
 */
export function NoteLookSwatch({ look }: { look: NoteLook }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-note-look={look.id}
      className={`inline-block shrink-0 font-sans text-xs font-medium leading-none ${look.colour}`}
    >
      <span className={look.shape}>1</span>
    </span>
  );
}
