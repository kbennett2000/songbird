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

/**
 * A place name shown beside its pin (issue #86) — so a curious reader can scan the map without
 * clicking every pin. Positioned to the right of the circle by the marker's anchor/offset (see
 * MapView). Place names are the *data* (the pin's color already encodes tier), so this is a
 * single readable dark style — heavier than the italic, secondary context labels — with a light
 * halo (`drop-shadow`) so it stays legible over varied relief. Non-interactive, so a tap lands
 * on the GL circle underneath.
 */
export function buildPlaceLabel(name: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.dataset.testid = "map-place-label";
  el.className =
    "pointer-events-none whitespace-nowrap text-[11px] font-medium text-stone-900/85 " +
    "[text-shadow:0_0_2px_rgba(255,255,255,0.9),0_0_2px_rgba(255,255,255,0.9)]";
  el.textContent = name;
  return el;
}

/** Up to this many member names are spelled out beside a stuck cluster; the rest collapse to "+N more". */
const STUCK_NAMES_SHOWN = 4;

/**
 * The member names of a cluster that can never resolve by zooming (its dots overlap no matter
 * how far the user zooms in) — shown stacked beside the cluster *in place of* its count, once
 * zoomed in (issue #118). So a reader can finally read both names without a click. Styled like
 * `buildPlaceLabel` (these are place-name *data*, with the same readable dark + halo treatment),
 * one name per line. Names beyond `STUCK_NAMES_SHOWN` collapse to a muted "+N more" line — the
 * cluster click → ClusterCard remains the full list. Non-interactive so a tap falls through to
 * the GL circle underneath.
 */
export function buildClusterNamesLabel(names: string[], total: number): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.testid = "map-cluster-names";
  el.className =
    "pointer-events-none flex flex-col gap-0.5 text-[11px] font-medium leading-tight text-stone-900/85 " +
    "[text-shadow:0_0_2px_rgba(255,255,255,0.9),0_0_2px_rgba(255,255,255,0.9)]";
  for (const name of names.slice(0, STUCK_NAMES_SHOWN)) {
    const line = document.createElement("span");
    line.className = "whitespace-nowrap";
    line.textContent = name;
    el.appendChild(line);
  }
  if (total > STUCK_NAMES_SHOWN) {
    const more = document.createElement("span");
    more.className = "whitespace-nowrap font-normal text-stone-900/60";
    more.textContent = `+${total - STUCK_NAMES_SHOWN} more`;
    el.appendChild(more);
  }
  return el;
}
