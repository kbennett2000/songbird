import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { DocumentDialog } from "@/components/DocumentDialog";
import { DOCUMENT_COLUMN, DOCUMENT_TEXT, useDocumentPictures } from "@/components/DocumentText";
import { NoteMarkdown } from "@/components/NoteMarkdown";
import { documentOptions } from "@/lib/documents";
import { bookIntroductionsOptions, introductionFor } from "@/lib/introductions";

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
 * A book's introduction (v1.8 slice C1), in a view that fills the window over the reader (see
 * `DocumentDialog`). The reader stays where it was underneath, so closing puts you back on the line
 * you were reading. The text is a study Bible's document from Concord, fetched through songbird and
 * never stored (invariants 1 and 5): Markdown with headings, lists, quotes, poetry, a timeline,
 * `ref:` links that jump the reader, and a picture that opens large.
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
  const list = useQuery(bookIntroductionsOptions(translation));
  const summary = introductionFor(list.data, book);
  const documentQuery = useQuery({
    ...documentOptions(translation, summary?.slug ?? ""),
    enabled: summary !== undefined,
  });
  const doc = documentQuery.data;

  const failed = list.isError || documentQuery.isError;
  const none = list.isSuccess && summary === undefined;
  const title = doc?.title ?? bookName;
  const pictures = useDocumentPictures({
    translation,
    images: doc?.images ?? [],
    title,
    subtitle: `${title} · Introduction`,
  });
  const tryAgain = () => {
    if (list.isError) void list.refetch();
    else void documentQuery.refetch();
  };

  return (
    <DocumentDialog
      dialogRef={dialogRef}
      titleId="book-introduction-title"
      eyebrow={
        <>Introduction{borrowed && <span className="normal-case"> · From {translation}</span>}</>
      }
      title={title}
      onClose={onClose}
      after={pictures.viewer}
    >
      <article className={`${DOCUMENT_COLUMN} ${DOCUMENT_TEXT}`}>
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
            renderImage={pictures.renderImage}
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
    </DocumentDialog>
  );
}
