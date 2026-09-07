import { Modal } from "@/components/Modal";

interface DismissMatchingDialogProps {
  open: boolean;
  /** How many rows would actually be marked — not how many are on screen. */
  count: number;
  /** The filter in words, e.g. "from Majestic View, up to 2024-12-31". Empty when only a state
   * narrows the list, which the sentence below reads perfectly well without. */
  describing: string;
  working: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The confirm in front of the bulk dismiss (spec §8).
 *
 * A dialog rather than the two-step inline confirm the per-row actions use, because this is the
 * one action on the page that reaches rows you cannot see. So it says the number **and the filter
 * in words**: "312 videos" alone is not something anyone can check, and undoing it means restoring
 * three hundred rows one at a time.
 *
 * Presentational — the caller owns the request, like `RedateSermonsModal`.
 */
export function DismissMatchingDialog({
  open,
  count,
  describing,
  working,
  onCancel,
  onConfirm,
}: DismissMatchingDialogProps): JSX.Element | null {
  if (!open) return null;
  const what = `${count} ${count === 1 ? "video" : "videos"}${describing ? ` ${describing}` : ""}`;

  return (
    // The question IS the title. `Modal` already renders one heading in its bar, and the live pass
    // showed a second below it saying the thing that actually mattered.
    <Modal open={open} title={`Mark ${what} as not a sermon?`} onClose={onCancel}>
      <div>
        <p className="text-sm text-gray-700 dark:text-gray-200">
          They move to <strong>Not a sermon</strong> and leave the list you&rsquo;re working
          through. Nothing is deleted — you can bring any of them back one at a time.
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Videos that already have notes, and any still waiting to be read, are left alone.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={working}
            className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {working ? "Dismissing…" : `Dismiss ${count}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
