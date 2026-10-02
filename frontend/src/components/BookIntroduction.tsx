import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { ChartPicture } from "@/components/ChartPicture";
import { ChartViewer } from "@/components/ChartViewer";
import { NoteMarkdown } from "@/components/NoteMarkdown";
import { bookIntroductionsOptions, documentOptions, introductionFor } from "@/lib/introductions";
import { chartImageUrl } from "@/lib/reader";

interface BookIntroductionProps {
  /** The Bible whose introduction it is ("EMB"). */
  translation: string;
  /** Another Bible's than the one being read (ticked under "Notes from other Bibles"). */
  borrowed: boolean;
  /** The open book's USFM code, and its name for the heading while the text loads. */
  book: string;
  bookName: string;
  /** Where the reader is ("Genesis 13"), for the way back at the end. */
  backTo: string;
  /** A `ref:` link: jump the reader there (the reader closes this view as it jumps). */
  onJump: (book: string, chapter: number, verse: number | null) => void;
  /** Called once the view has closed — by Close, Back, Escape, or Android's Back. */
  onClose: () => void;
}

/**
 * A book's introduction (v1.8 slice C1), in a view that fills the window over the reader: a native
 * modal `<dialog>`, like the chart viewer. The reader stays where it was underneath, so closing
 * puts you back on the line you were reading. The text is a study Bible's document from Concord,
 * fetched through songbird and never stored (invariants 1 and 5): Markdown with headings, lists,
 * quotes, poetry, a timeline, `ref:` links that jump the reader, and a picture that opens large.
 */
export function BookIntroduction({
  translation,
  borrowed,
  book,
  bookName,
  backTo,
  onJump,
  onClose,
}: BookIntroductionProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const list = useQuery(bookIntroductionsOptions(translation));
  const summary = introductionFor(list.data, book);
  const documentQuery = useQuery({
    ...documentOptions(translation, summary?.slug ?? ""),
    enabled: summary !== undefined,
  });
  const doc = documentQuery.data;
  // The picture's large view, and the picture's button to give focus back to when it closes.
  const [viewer, setViewer] = useState<{
    name: string;
    alt: string;
    button: HTMLButtonElement;
  } | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    bodyRef.current?.focus();
    // No close() on unmount: taking an open dialog out of the page already takes it out of the top
    // layer, and a close() there would fire onClose (see ChartViewer).
  }, []);

  const failed = list.isError || documentQuery.isError;
  const none = list.isSuccess && summary === undefined;
  const title = doc?.title ?? bookName;
  const tryAgain = () => {
    if (list.isError) void list.refetch();
    else void documentQuery.refetch();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="book-introduction-title"
      // Only this dialog's own close: React passes the picture viewer's (a dialog inside this one)
      // up the tree too, though the browser's close event doesn't bubble.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none flex-col bg-white p-0 text-gray-900 open:flex dark:bg-gray-900 dark:text-gray-100 backdrop:bg-black/60"
    >
      <header className="border-b border-gray-200 dark:border-gray-700 py-2">
        <div className="mx-auto flex max-w-prose items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Introduction{borrowed && <span className="normal-case"> · From {translation}</span>}
            </p>
            <h2 id="book-introduction-title" className="truncate text-xl font-semibold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            className="inline-flex h-10 items-center rounded border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
        </div>
      </header>

      <div
        ref={bodyRef}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none"
      >
        <article className="mx-auto max-w-prose px-4 py-6 text-base leading-7 [&>div]:gap-4 [&_li+li]:mt-1.5">
          {failed ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-red-600 dark:text-red-400">
                Couldn&rsquo;t load the introduction (is Concord reachable?)
              </p>
              <button
                type="button"
                className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                onClick={tryAgain}
              >
                Try again
              </button>
            </div>
          ) : none ? (
            <p className="text-gray-600 dark:text-gray-400">
              {translation} has no introduction to {bookName}.
            </p>
          ) : !doc ? (
            <p className="text-gray-600 dark:text-gray-400">Loading the introduction…</p>
          ) : (
            <NoteMarkdown
              text={doc.text}
              onJump={onJump}
              headingBase={3}
              renderImage={(name, alt) => {
                const image = doc.images.find((i) => i.name === name);
                return (
                  <figure className="my-2 flex flex-col items-center gap-1">
                    <ChartPicture
                      size="figure"
                      noun="picture"
                      src={chartImageUrl(translation, name)}
                      alt={alt}
                      label={`Open the picture larger: ${alt}`}
                      aspect={image ? { width: image.width, height: image.height } : undefined}
                      onOpen={(button) => setViewer({ name, alt, button })}
                    />
                    <figcaption className="text-sm text-gray-600 dark:text-gray-400">
                      {alt && <>{alt} · </>}
                      {/* For a pointer or a finger; the picture itself is the keyboard's way in. */}
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
                        onClick={(e) => {
                          const picture = e.currentTarget
                            .closest("figure")
                            ?.querySelector<HTMLButtonElement>("[data-chart-picture] button");
                          if (picture) setViewer({ name, alt, button: picture });
                        }}
                      >
                        ⤢ Open larger
                      </button>
                    </figcaption>
                  </figure>
                );
              }}
            />
          )}
          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-4">
            <button
              type="button"
              className="font-medium text-blue-700 dark:text-blue-400 hover:underline"
              onClick={() => dialogRef.current?.close()}
            >
              ← Back to {backTo}
            </button>
          </div>
        </article>
      </div>

      {viewer && (
        <ChartViewer
          src={chartImageUrl(translation, viewer.name)}
          title={viewer.alt || title}
          subtitle={`${title} · Introduction`}
          alt={viewer.alt}
          noun="picture"
          onClose={() => {
            const button = viewer.button;
            setViewer(null);
            requestAnimationFrame(() => button.focus());
          }}
        />
      )}
    </dialog>
  );
}
