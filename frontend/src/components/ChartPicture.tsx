import { useEffect, useRef, useState } from "react";

interface ChartPictureProps {
  /** The picture's URL (`chartImageUrl`): songbird's pass-through to Concord. */
  src: string;
  /** The picture's text alternative ("Chart: Abram Moves On"). */
  alt: string;
  /** The button's name ("Open the chart larger: Abram Moves On"). */
  label: string;
  /** `note`: the full width of the note box. `thumb`: a small preview on the Search page. */
  size: "note" | "thumb";
  /** Open the large view; given the button, so focus can come back to it. */
  onOpen: (button: HTMLButtonElement) => void;
  /** Move focus to the picture when it appears (the note reopening after the large view). */
  autoFocus?: boolean;
}

type Status = "loading" | "loaded" | "failed";

const FRAME = {
  note: "h-48 w-full",
  thumb: "h-20 w-28 shrink-0",
} as const;

/**
 * A chart's picture inside a fixed-size frame, as a button that opens the large view
 * ({@link ChartViewer}). The frame takes the same space while the picture loads, once it has, and
 * if it fails, so the note box never changes size under its marker (the popover places itself once,
 * from its height when it opens). The picture is contained — the whole chart shows, small — on a
 * white ground in both themes, so it reads as the printed page it is; its words are inside it, so
 * the large view is where it's read. A failure says so and offers to ask again; the rest of the note
 * (its title, the passage it covers, the link) stays usable.
 */
export function ChartPicture({
  src,
  alt,
  label,
  size,
  onOpen,
  autoFocus = false,
}: ChartPictureProps): JSX.Element {
  const [status, setStatus] = useState<Status>("loading");
  // Each "Try again" is a fresh request: an error isn't cached, but a new URL makes sure of it.
  const [attempt, setAttempt] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const url = attempt === 0 ? src : `${src}?attempt=${attempt}`;

  // A frame later: the popover first renders hidden while it measures itself, and an element
  // inside a hidden one can't take focus.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => buttonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const note = size === "note";
  return (
    <div
      data-chart-picture={status}
      aria-live="polite"
      className={`relative overflow-hidden rounded bg-white ring-1 ring-gray-200 dark:ring-gray-600 ${FRAME[size]}`}
    >
      {status === "failed" ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 bg-gray-100 dark:bg-gray-700 p-2 text-center text-xs text-gray-700 dark:text-gray-200">
          <p>
            {note ? "Couldn’t load the chart’s picture (is Concord reachable?)." : "Couldn’t load."}
          </p>
          <button
            type="button"
            className="font-medium text-blue-700 dark:text-blue-300 hover:underline"
            onClick={() => {
              setStatus("loading");
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          className="group block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          onClick={(e) => onOpen(e.currentTarget)}
        >
          <img
            key={attempt}
            src={url}
            alt={alt}
            loading={note ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("failed")}
            className={`h-full w-full object-contain transition-opacity duration-200 ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
          />
          {status === "loading" && (
            <span className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300">
              {note ? "Loading the chart…" : "Loading…"}
            </span>
          )}
          {status === "loaded" && note && (
            <span
              aria-hidden="true"
              className="absolute bottom-1 right-1 rounded bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white group-hover:bg-black/80"
            >
              ⤢ Open larger
            </span>
          )}
        </button>
      )}
    </div>
  );
}
