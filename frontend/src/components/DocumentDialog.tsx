import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";

interface DocumentDialogProps {
  /** The dialog itself: Close, and any way back inside the page, call its `close()`. */
  dialogRef: RefObject<HTMLDialogElement>;
  /** The scrolling body, for a caller that moves it (back to the top for a new page). */
  bodyRef?: RefObject<HTMLDivElement>;
  /** The title's id, which names the dialog. */
  titleId: string;
  /** The small line over the title ("Introduction · From EMB"). */
  eyebrow: ReactNode;
  title: ReactNode;
  /** Before the title, such as a back button. */
  leading?: ReactNode;
  /** Let a long title take two lines instead of cutting it short. */
  wrapTitle?: boolean;
  /** A row under the title that never scrolls away (the reading plan's month and day). */
  bar?: ReactNode;
  /**
   * Escape, or Android's Back. Return true when it was handled (a step back inside the page) to
   * keep the dialog open; otherwise it closes.
   */
  onCancel?: () => boolean;
  /** Called once the dialog has closed, however it closed. */
  onClose: () => void;
  /** Inside the dialog but outside its scrolling body: a picture's large view. */
  after?: ReactNode;
  children: ReactNode;
}

/**
 * A study Bible's document over the page (v1.8 slices C1 and C2): a native modal `<dialog>` that
 * fills the window, like the chart viewer, with a header that stays put and a body with its own
 * scroll. Whatever it opens over stays mounted underneath, so closing puts you back where you were.
 */
export function DocumentDialog({
  dialogRef,
  bodyRef,
  titleId,
  eyebrow,
  title,
  leading,
  wrapTitle = false,
  bar,
  onCancel,
  onClose,
  after,
  children,
}: DocumentDialogProps): JSX.Element {
  const ownBodyRef = useRef<HTMLDivElement>(null);
  const body = bodyRef ?? ownBodyRef;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    body.current?.focus();
    // No close() on unmount: taking an open dialog out of the page already takes it out of the top
    // layer, and a close() there would fire onClose (see ChartViewer).
  }, [dialogRef, body]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Only this dialog's own events: React passes a picture viewer's (a dialog inside this one)
      // up the tree too, though the browser's cancel and close events don't bubble.
      onCancel={(e) => {
        if (e.target === e.currentTarget && onCancel?.()) e.preventDefault();
      }}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none flex-col bg-white p-0 text-gray-900 open:flex dark:bg-gray-900 dark:text-gray-100 backdrop:bg-black/60"
    >
      <header className="border-b border-gray-200 dark:border-gray-700 py-2">
        <div className="mx-auto flex max-w-prose items-center gap-3 px-4">
          {leading}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {eyebrow}
            </p>
            <h2
              id={titleId}
              className={`${wrapTitle ? "line-clamp-2" : "truncate"} text-xl font-semibold`}
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center rounded border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
        </div>
        {bar}
      </header>

      <div
        ref={body}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none"
      >
        {children}
      </div>

      {after}
    </dialog>
  );
}
