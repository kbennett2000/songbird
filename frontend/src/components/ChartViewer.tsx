import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  ZOOM_STEP,
  clampScale,
  doubleTapScale,
  fitScale,
  pointUnder,
  scrollToKeep,
  type Size,
} from "@/lib/chartZoom";

interface ChartViewerProps {
  /** The picture's URL (`chartImageUrl`). */
  src: string;
  /** The chart's title: the dialog's heading and name. */
  title: string;
  /** A line under the title: "Covers Genesis 13:1-4", or the verse the chart stands at. */
  subtitle?: string | null;
  /** The picture's text alternative. */
  alt: string;
  /** Called once the dialog has closed — by Close, Escape, or Android's Back. */
  onClose: () => void;
}

/** A point in the scroll box's visible area, in CSS pixels from its top-left corner. */
interface Point {
  x: number;
  y: number;
}

/** A zoom waiting to be applied: the picture pixel to keep under `focal` once the new size renders. */
interface PendingScroll {
  point: Point;
  focal: Point;
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

/**
 * A chart, large enough to read: a native modal `<dialog>` filling the window, opened from a
 * chart's picture ({@link ChartPicture}). `showModal()` puts it in the top layer, above every
 * popover, makes the page behind it inert and keeps focus inside; Escape (and Android's Back) close
 * it through the dialog's own `cancel`.
 *
 * The picture sits in a native scroll box and zooms by changing its size, so dragging, momentum and
 * the arrow keys are the browser's own. It opens fitted (the whole chart on screen, never enlarged
 * past its own size) and zooms to three times its own pixels: with − and +, a pinch, a double-tap
 * or double-click, Ctrl + wheel (a trackpad pinch), or the keys + − 0. Every zoom keeps the point
 * under the fingers, the pointer, or the centre still (lib/chartZoom.ts). No zoom library — songbird
 * stays lean.
 */
export function ChartViewer({ src, title, subtitle, alt, onClose }: ChartViewerProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  // null: fitted to the box, following it as the window turns or resizes. Else a fixed scale.
  const [scale, setScale] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<PendingScroll | null>(null);

  const fit = natural ? fitScale(natural, box) : 1;
  const current = scale ?? fit;
  // Read inside gesture handlers, which outlive a render.
  const live = useRef({ natural, box, fit, current });
  live.current = { natural, box, fit, current };

  // Open as a modal on mount. No close on unmount: taking an open dialog out of the page already
  // takes it out of the top layer, and a close() there would fire onClose — under StrictMode's
  // double-run effects, shutting the viewer the moment it opened.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    boxRef.current?.focus();
  }, []);

  // The box's size: what "fit" means, and where its centre is.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Zoom to `next` (clamped), keeping the picture pixel under `focal` where it is. */
  const zoomTo = useCallback((next: number, focal?: Point) => {
    const { natural: n, box: b, fit: f, current: from } = live.current;
    const el = boxRef.current;
    if (!n || !el) return;
    const to = clampScale(next, f);
    const at = focal ?? { x: b.width / 2, y: b.height / 2 };
    pending.current = {
      point: {
        x: pointUnder(el.scrollLeft, at.x, b.width, n.width, from),
        y: pointUnder(el.scrollTop, at.y, b.height, n.height, from),
      },
      focal: at,
    };
    // Back at (or below) the fitted scale is "fitted": it then follows the box.
    setScale(to <= f + 1e-6 ? null : to);
  }, []);

  /** Keep a picture pixel under a moving point at the current scale (a pinch's drag). */
  const placeAfterRender = useCallback((point: Point, focal: Point) => {
    pending.current = { point, focal };
  }, []);

  // After a zoom renders the picture at its new size, scroll so the kept pixel is back in place.
  useLayoutEffect(() => {
    const p = pending.current;
    const el = boxRef.current;
    if (!p || !el || !natural) return;
    pending.current = null;
    el.scrollLeft = scrollToKeep(p.point.x, p.focal.x, box.width, natural.width, current);
    el.scrollTop = scrollToKeep(p.point.y, p.focal.y, box.height, natural.height, current);
  });

  // Pinch and Ctrl + wheel need listeners that can stop the page itself from zooming.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const local = (clientX: number, clientY: number): Point => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    let pinch: { distance: number; scale: number; point: Point } | null = null;
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        mid: local((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
      };
    };
    const onTouchStart = (e: TouchEvent) => {
      const { natural: n, box: b, current: s } = live.current;
      if (e.touches.length !== 2 || !n) return;
      e.preventDefault();
      const { distance, mid } = two(e);
      pinch = {
        distance,
        scale: s,
        point: {
          x: pointUnder(el.scrollLeft, mid.x, b.width, n.width, s),
          y: pointUnder(el.scrollTop, mid.y, b.height, n.height, s),
        },
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const { distance, mid } = two(e);
      const { fit: f } = live.current;
      const to = clampScale((pinch.scale * distance) / Math.max(pinch.distance, 1), f);
      // The pixel that started under the fingers follows them: zoom and pan in one move.
      const { natural: n, box: b, current: s } = live.current;
      if (n && Math.abs(to - s) < 1e-6) {
        // At a limit the size doesn't change, so no render follows: pan straight away.
        el.scrollLeft = scrollToKeep(pinch.point.x, mid.x, b.width, n.width, s);
        el.scrollTop = scrollToKeep(pinch.point.y, mid.y, b.height, n.height, s);
        return;
      }
      placeAfterRender(pinch.point, mid);
      setScale(to <= f + 1e-6 ? null : to);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // a plain wheel scrolls the box
      e.preventDefault();
      zoomTo(live.current.current * Math.exp(-e.deltaY * 0.01), local(e.clientX, e.clientY));
    };
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [zoomTo, placeAfterRender]);

  // Double-tap (touch) and double-click (mouse): fitted ↔ the picture's own size.
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastPointer = useRef<string>("mouse");
  const toggleAt = (focal: Point) => {
    if (scale !== null) zoomTo(fit, focal);
    else zoomTo(doubleTapScale(fit), focal);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType !== "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    const here = { time: e.timeStamp, x: e.clientX, y: e.clientY };
    const prev = lastTap.current;
    if (
      prev &&
      here.time - prev.time < DOUBLE_TAP_MS &&
      Math.hypot(here.x - prev.x, here.y - prev.y) < DOUBLE_TAP_PX
    ) {
      lastTap.current = null;
      toggleAt({ x: e.clientX - r.left, y: e.clientY - r.top });
    } else {
      lastTap.current = here;
    }
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (lastPointer.current === "touch") return; // a double-tap is handled on pointerup
    const r = e.currentTarget.getBoundingClientRect();
    toggleAt({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave the browser's own zoom keys alone
    if (e.key === "+" || e.key === "=") zoomTo(current * ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomTo(current / ZOOM_STEP);
    else if (e.key === "0") zoomTo(fit);
    else return;
    e.preventDefault();
  };

  const percent = `${Math.round(current * 100)}%`;
  const atFit = scale === null;
  const atMax = natural !== null && current >= clampScale(Infinity, fit) - 1e-6;
  const control =
    "inline-flex h-10 min-w-10 items-center justify-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-gray-800";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="chart-viewer-title"
      onClose={onClose}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 hidden h-dvh max-h-none w-screen max-w-none flex-col bg-white p-0 text-gray-900 open:flex dark:bg-gray-900 dark:text-gray-100 backdrop:bg-black/80"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
        <div className="order-1 min-w-0 flex-1">
          <h2 id="chart-viewer-title" className="truncate font-semibold">
            {title}
          </h2>
          {subtitle && (
            <p className="truncate text-xs text-gray-600 dark:text-gray-400">{subtitle}</p>
          )}
        </div>
        <div className="order-3 flex w-full items-center gap-1 sm:order-2 sm:w-auto">
          <button
            type="button"
            className={control}
            aria-label="Zoom out"
            disabled={!natural || atFit}
            onClick={() => zoomTo(current / ZOOM_STEP)}
          >
            −
          </button>
          <span
            aria-live="polite"
            className="w-14 text-center text-sm tabular-nums text-gray-700 dark:text-gray-300"
          >
            <span className="sr-only">Zoom </span>
            {percent}
          </span>
          <button
            type="button"
            className={control}
            aria-label="Zoom in"
            disabled={!natural || atMax}
            onClick={() => zoomTo(current * ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className={control}
            disabled={!natural || atFit}
            onClick={() => zoomTo(fit)}
          >
            Fit
          </button>
        </div>
        <button
          type="button"
          className={`order-2 sm:order-3 ${control}`}
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>

      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label="Chart picture: use the arrow keys to move around"
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        className="flex min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:bg-gray-950"
      >
        {failed ? (
          <div className="m-auto flex flex-col items-center gap-2 p-4 text-center text-sm">
            <p>Couldn’t load the chart’s picture (is Concord reachable?).</p>
            <button
              type="button"
              className="font-medium text-blue-700 dark:text-blue-300 hover:underline"
              onClick={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {!natural && (
              <p className="m-auto p-4 text-sm text-gray-600 dark:text-gray-400">
                Loading the chart…
              </p>
            )}
            <img
              key={attempt}
              src={attempt === 0 ? src : `${src}?attempt=${attempt}`}
              alt={alt}
              draggable={false}
              onLoad={(e) =>
                setNatural({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
              style={
                natural
                  ? { width: natural.width * current, height: natural.height * current }
                  : undefined
              }
              className={`m-auto max-w-none select-none bg-white ${natural ? "" : "sr-only"}`}
            />
          </>
        )}
      </div>

      <p className="px-3 py-1.5 text-center text-xs text-gray-600 dark:text-gray-400">
        Pinch, double-tap or use + and − to zoom. Drag to move around.
        <span className="sr-only">
          {" "}
          The chart’s words are part of the picture and aren’t available as text.
        </span>
      </p>
    </dialog>
  );
}
