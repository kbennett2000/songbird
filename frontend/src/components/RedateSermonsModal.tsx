import { Modal } from "@/components/Modal";
import { formatEventDate } from "@/lib/notes";
import type { RedateItem, RedateResult } from "@/schemas";

interface RedateSermonsModalProps {
  /** The preview to show, or null when there is nothing to show and the dialog stays closed. */
  preview: RedateResult | null;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}

/** Which of YouTube's two timestamps decided a date, in words rather than field names. */
const SOURCE_LABEL: Record<RedateItem["date_source"], string> = {
  stream_start: "stream started",
  published: "published",
};

/** "3 dates" / "1 date" — the counts line reads as a sentence, so it has to agree. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ItemRow({ item }: { item: RedateItem }): JSX.Element {
  return (
    <li
      className={`rounded border p-3 ${
        item.changed
          ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
          : "border-gray-100 dark:border-gray-800 bg-transparent opacity-60"
      }`}
    >
      <p className="font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{item.reference}</p>
      <p className="mt-1 text-sm">
        {item.changed ? (
          <>
            <span className="text-gray-500 dark:text-gray-400 line-through">
              {item.current_date ? formatEventDate(item.current_date) : "no date"}
            </span>
            <span aria-hidden="true" className="mx-1.5 text-gray-400 dark:text-gray-500">
              →
            </span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {formatEventDate(item.new_date)}
            </span>
          </>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">
            {formatEventDate(item.new_date)} · already correct
          </span>
        )}
        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
          ({SOURCE_LABEL[item.date_source]})
        </span>
      </p>
      <a
        href={item.sermon_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
      >
        ▶ Watch
      </a>
    </li>
  );
}

/**
 * The re-date preview (v1.7 sermon sources, spec §11): what would change, before anything does.
 *
 * A list of cards rather than a table — every list in songbird is one, and five columns don't fit
 * a phone. Rows that would change are shown in full; rows that already agree with YouTube are
 * kept but muted, so you can see the action was thorough without them competing for attention.
 *
 * Presentational only: the caller owns both requests, so all the data flow for this action lives
 * in one place.
 */
export function RedateSermonsModal({
  preview,
  applying,
  onApply,
  onClose,
}: RedateSermonsModalProps): JSX.Element | null {
  if (preview === null) return null;

  const changing = preview.items.filter((i) => i.changed).length;

  return (
    <Modal open title="Re-date YouTube sermons" onClose={onClose}>
      <p className="text-sm text-gray-700 dark:text-gray-200">
        {plural(preview.total_youtube_notes, "sermon note links", "sermon notes link")} to YouTube ·{" "}
        <span className="font-semibold">{plural(changing, "date", "dates")}</span> would change
        {preview.skipped_non_youtube > 0
          ? ` · ${plural(preview.skipped_non_youtube, "note isn’t", "notes aren’t")} on YouTube`
          : ""}
      </p>

      {preview.total_youtube_notes === 0 ? (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          None of your sermon notes link to a YouTube video, so there’s nothing to re-date.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {preview.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {preview.not_found.length > 0 && (
        <section aria-label="Not found on YouTube" className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Couldn’t be found on YouTube
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            These videos are private or have been removed, so their dates are left as they are.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {preview.not_found.map((n) => (
              <li key={n.id} className="text-sm text-gray-700 dark:text-gray-200">
                {n.title} <span className="text-gray-500 dark:text-gray-400">· {n.reference}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          onClick={onApply}
          disabled={changing === 0 || applying}
        >
          {applying ? "Applying…" : "Apply"}
        </button>
        <button
          type="button"
          className="text-sm text-blue-700 dark:text-blue-400 hover:underline"
          onClick={onClose}
          disabled={applying}
        >
          Cancel
        </button>
        {changing === 0 && preview.total_youtube_notes > 0 && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Every date already matches YouTube.
          </span>
        )}
      </div>
    </Modal>
  );
}
