import type { LabelKind } from "@/lib/map/labels";

/**
 * DOM builders for the only text on the map: cluster-count badges and curated context labels.
 * Drawn as MapLibre HTML markers rather than GL `symbol`/`text` layers — which means **no font
 * glyphs to bundle**, keeping the offline story simple (ADR 0003). Both are non-interactive
 * (`pointer-events: none`) so taps fall through to the GL circle layers, where the click handlers
 * live. Pure and unit-testable.
 */

/** The number on a cluster, centered over its GL circle. */
export function buildClusterBadge(count: number): HTMLSpanElement {
  const el = document.createElement("span");
  el.dataset.testid = "map-cluster";
  el.dataset.count = String(count);
  el.className =
    "pointer-events-none select-none text-xs font-bold leading-none text-white drop-shadow";
  el.textContent = String(count);
  return el;
}

const LABEL_CLASS: Record<LabelKind, string> = {
  sea: "text-[11px] italic text-sky-900/70",
  river: "text-[10px] italic text-sky-900/70",
  region: "text-[10px] font-medium uppercase tracking-widest text-stone-700/70",
  mountain: "text-[10px] text-stone-700/80",
  desert: "text-[10px] uppercase tracking-wider text-amber-800/60",
};

/** A curated context label (sea/region/river/mountain/desert). */
export function buildLabelElement(name: string, kind: LabelKind): HTMLSpanElement {
  const el = document.createElement("span");
  el.dataset.testid = "map-label";
  el.dataset.kind = kind;
  el.className = `pointer-events-none whitespace-nowrap drop-shadow-sm ${LABEL_CLASS[kind]}`;
  el.textContent = name;
  return el;
}
