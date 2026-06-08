import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

interface PopoverProps {
  /** The element the popover anchors to (e.g. the tapped marker button). */
  anchor: HTMLElement;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}

/**
 * A self-contained floating popover anchored to an element (no popover dependency — songbird
 * stays lean). Positions below the anchor if there's room, else above, clamped to the viewport,
 * and dismisses on Esc, outside-click, an OUTSIDE scroll, or resize — while letting its own
 * overflow content scroll. Used by the translator-note and sermon-note popovers.
 */
export function Popover({ anchor, onClose, ariaLabel, children }: PopoverProps): JSX.Element {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Position relative to the anchor: below if there's room, else above; clamped to the viewport.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 6;
    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, vw - pop.offsetWidth - margin),
    );
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    if (spaceBelow >= Math.min(pop.offsetHeight, 160) || spaceBelow >= spaceAbove) {
      setPos({ top: rect.bottom + gap, left, maxHeight: spaceBelow });
    } else {
      const maxHeight = spaceAbove;
      setPos({ top: rect.top - gap - Math.min(pop.offsetHeight, maxHeight), left, maxHeight });
    }
  }, [anchor]);

  // Dismiss on Esc, outside-click, an OUTSIDE scroll, or resize.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!popRef.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    // Dismiss when an OUTSIDE surface scrolls (reader/page) so the popover never drifts from its
    // anchor — but let the popover scroll its own overflow content. `capture: true` is needed to
    // catch scrolls from any scroll container; that also delivers the popover's own scroll events
    // here, so we ignore scrolls that originate inside it.
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label={ariaLabel}
      className="fixed z-40 w-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm shadow-xl"
      style={
        pos
          ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
          : { top: 0, left: 0, visibility: "hidden" }
      }
    >
      {children}
    </div>
  );
}
