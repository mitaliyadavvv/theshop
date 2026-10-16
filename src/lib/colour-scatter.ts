import type { ColourFamily, Hsl } from "./colour";

/**
 * Colour scatter plot: products as points on a 2D colour map.
 *
 *   x  hue, as one continuous spectrum: reds/oranges (left) → yellows → greens → [centre]
 *      → blues → purples → pinks (right). Saturation pulls a piece toward the centre line,
 *      so the vertical axis becomes a neutral spine (whites at top, greys, blacks at bottom).
 *   y  lightness: light at the top, deep at the bottom; the horizontal axis is mid-lightness.
 *
 * Everything here is deterministic (hash of the product id), so a layout never reshuffles.
 */

export type ScatterInput = { id: string; colour: Hsl & { family: ColourFamily }; aspect: number /* w/h */ };
export type Placed = { id: string; x: number; y: number; w: number; h: number; tier: Tier };
export type Tier = "s" | "m" | "l";

/* ------------------------------------------------------------ deterministic hash */
export function hashUnit(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------ colour → plane */
/** Hue position 0…1 along the spectrum, starting at crimson (345°) so reds sit at the far left. */
export const huePosition = (h: number) => ((h - 345 + 360) % 360) / 360;

/** Anchor in the unit square (0…1, 0…1) for a colour, before any spreading. */
export function anchorOf(c: Hsl, id: string): { x: number; y: number } {
  const reach = 0.12 + 0.88 * Math.min(1, c.s / 70);        // saturated = far out, dusty = near centre
  // Neutrals have no meaningful hue: they sit on the central spine.
  const x = c.s < 18 ? 0.5 : 0.5 + (huePosition(c.h) * 2 - 1) * 0.5 * reach;
  const y = (100 - c.l) / 100;
  // Small fixed jitter: many products share a named colour ("black", "olive"), so give each its own spot.
  return {
    x: clamp01(x + (hashUnit(id, 1) - 0.5) * (c.s < 18 ? 0.05 : 0.07)),
    y: clamp01(y + (hashUnit(id, 2) - 0.5) * 0.09),
  };
}

/** Axis ticks for the hue spectrum (full-saturation positions). */
export const HUE_TICKS = [
  { label: "Red", h: 358 }, { label: "Orange", h: 28 }, { label: "Yellow", h: 52 }, { label: "Green", h: 120 },
  { label: "Blue", h: 215 }, { label: "Purple", h: 275 }, { label: "Pink", h: 330 },
].map((t) => ({ ...t, x: 0.5 + (huePosition(t.h) * 2 - 1) * 0.5 }));

/* ------------------------------------------------------------ sizes */
/** Stable size tier: roughly 12% large, 33% medium, the rest small. */
export function tierOf(id: string): Tier {
  const u = hashUnit(id, 3);
  return u < 0.12 ? "l" : u < 0.45 ? "m" : "s";
}

/** Tile widths (px) for a canvas width; smaller screens get proportionally larger tiles. */
export function tileWidths(canvasWidth: number): Record<Tier, number> {
  const k = Math.max(0.78, Math.min(1, canvasWidth / 1240));
  return canvasWidth < 560 ? { s: 42, m: 56, l: 78 } : { s: Math.round(50 * k), m: Math.round(70 * k), l: Math.round(108 * k) };
}

/* ------------------------------------------------------------ curated subset */
/**
 * Pick `n` items spread evenly over colour space: bin the plane into cells and take items
 * round-robin from each cell (stable order), so every populated region — all four quadrants —
 * is represented instead of the most common colours crowding everything out.
 */
export function curate<T extends ScatterInput>(items: T[], n: number, cols = 10, rows = 8): T[] {
  if (items.length <= n) return items;
  const cells = new Map<number, T[]>();
  for (const it of items) {
    const a = anchorOf(it.colour, it.id);
    const k = Math.min(rows - 1, Math.floor(a.y * rows)) * cols + Math.min(cols - 1, Math.floor(a.x * cols));
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(it);
  }
  // Visit cells in a fixed scattered order (not top-to-bottom), so a small selection still
  // reaches the deep shades at the bottom and every quadrant.
  const queues = [...cells.entries()].sort((a, b) => hashUnit(String(a[0]), 5) - hashUnit(String(b[0]), 5))
    .map(([, list]) => list.sort((a, b) => hashUnit(a.id, 4) - hashUnit(b.id, 4)));
  const out: T[] = [];
  for (let round = 0; out.length < n; round++) {
    let took = false;
    for (const q of queues) if (q[round] && out.length < n) { out.push(q[round]); took = true; }
    if (!took) break;
  }
  return out;
}

/* ------------------------------------------------------------ layout */
const GAP = 7;          // breathing room between pieces (px)
const PAD = 24;         // keep pieces off the canvas edge

/** How many pieces fit a canvas of `width` × (width × `aspect`) with room to breathe. */
export function curatedCount(width: number, aspect: number): number {
  const sizes = tileWidths(width);
  const avg = 0.55 * area(sizes.s) + 0.33 * area(sizes.m) + 0.12 * area(sizes.l);
  return Math.max(24, Math.floor((width * width * aspect * fillFor(width)) / avg));
}
const area = (w: number) => (w + GAP) * (w / 0.8 + GAP);
const fillFor = (width: number) => (width < 560 ? 0.34 : 0.4);

/** Canvas height that gives the pieces room to breathe at this width. */
export function canvasHeight(items: ScatterInput[], width: number, minHeight: number): number {
  const sizes = tileWidths(width);
  let area = 0;
  for (const it of items) { const w = sizes[tierOf(it.id)] + GAP; area += w * (w / it.aspect + GAP); }
  return Math.round(Math.max(minHeight, area / fillFor(width) / width));   // fill = fraction covered by pieces
}

/**
 * Place every item near its colour anchor without overlaps: start at the anchor, then
 * repeatedly push overlapping boxes apart (bigger pieces move less) while a gentle spring
 * pulls each back toward its colour. Fixed iteration order → identical result every time.
 */
export function layoutScatter(items: ScatterInput[], width: number, height: number, opts: { fit?: boolean } = {}): Placed[] {
  const sizes = tileWidths(width);
  const anchors = new Map(items.map((it) => [it.id, anchorOf(it.colour, it.id)]));
  // fit: zoom into the region these items occupy (e.g. one colour family), keeping their
  // relative positions, so a filtered view fills the canvas instead of a thin band.
  if (opts.fit && items.length > 1) {
    const xs = [...anchors.values()].map((a) => a.x), ys = [...anchors.values()].map((a) => a.y);
    const stretch = (v: number, lo: number, hi: number) => (hi - lo < 0.08 ? 0.5 + (v - (lo + hi) / 2) * 4 : (v - lo) / (hi - lo));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const [id, a] of anchors) anchors.set(id, { x: clamp01(stretch(a.x, x0, x1)), y: clamp01(stretch(a.y, y0, y1)) });
  }
  const nodes = items.map((it) => {
    const tier = tierOf(it.id);
    const w = sizes[tier], h = Math.round(w / it.aspect);
    const a = anchors.get(it.id)!;
    const ax = PAD + w / 2 + a.x * (width - 2 * PAD - w);
    const ay = PAD + h / 2 + a.y * (height - 2 * PAD - h);
    return { id: it.id, tier, w, h, ax, ay, x: ax, y: ay, mass: w * h };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));                // stable processing order

  const maxDim = Math.max(...nodes.map((n) => Math.max(n.w, n.h)), 1) + GAP;
  const cell = maxDim;
  const lo = (n: typeof nodes[number], axis: "x" | "y") => PAD + (axis === "x" ? n.w : n.h) / 2;
  const hi = (n: typeof nodes[number], axis: "x" | "y") => (axis === "x" ? width : height) - PAD - (axis === "x" ? n.w : n.h) / 2;
  /** Move a node along one axis within the canvas; returns the part of the move a wall blocked. */
  const push = (n: typeof nodes[number], axis: "x" | "y", d: number) => {
    const next = Math.max(lo(n, axis), Math.min(hi(n, axis), n[axis] + d));
    const blocked = d - (next - n[axis]);
    n[axis] = next;
    return blocked;
  };

  // Phase 1: separate while a gentle spring keeps pieces near their colour.
  // Phase 2: separation only, until nothing overlaps (or a safety cap).
  for (let iter = 0; iter < 420; iter++) {
    const spring = iter < 110 ? 0.04 : 0;
    const grid = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    });
    let moved = 0;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j <= i) continue;
          const b = nodes[j];
          const ox = (a.w + b.w) / 2 + GAP - Math.abs(a.x - b.x);
          const oy = (a.h + b.h) / 2 + GAP - Math.abs(a.y - b.y);
          if (ox <= 0 || oy <= 0) continue;
          const axis: "x" | "y" = ox < oy ? "x" : "y";
          const sign = a[axis] < b[axis] || (a[axis] === b[axis] && a.id < b.id) ? -1 : 1;
          const d = sign * (axis === "x" ? ox : oy);
          const share = b.mass / (a.mass + b.mass);          // the lighter piece moves more
          // If a wall stops one piece, the other takes the rest of the push.
          const leftA = push(a, axis, d * share);
          const leftB = push(b, axis, -d * (1 - share) - leftA);
          if (leftB) push(a, axis, -leftB);
          moved++;
        }
      }
    }
    if (spring) for (const n of nodes) { push(n, "x", (n.ax - n.x) * spring); push(n, "y", (n.ay - n.y) * spring); }
    if (!moved && iter >= 110) break;
  }
  // Final guarantee: any piece still overlapping moves to the nearest free spot, found by a
  // fixed outward spiral (deterministic). Only a handful of pieces ever reach this step.
  const overlapsAny = (n: typeof nodes[number], x: number, y: number, upTo: number) => {
    for (let k = 0; k < upTo; k++) {
      const o = nodes[k];
      if (Math.abs(x - o.x) < (n.w + o.w) / 2 + GAP - 0.5 && Math.abs(y - o.y) < (n.h + o.h) / 2 + GAP - 0.5) return true;
    }
    return false;
  };
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (!overlapsAny(n, n.x, n.y, i)) continue;
    search: for (let r = 6; r < Math.max(width, height); r += 6) {
      const steps = Math.max(8, Math.round((2 * Math.PI * r) / 6));
      for (let k = 0; k < steps; k++) {
        const t = (k / steps) * 2 * Math.PI;
        const x = n.x + r * Math.cos(t), y = n.y + r * Math.sin(t);
        if (x < lo(n, "x") || x > hi(n, "x") || y < lo(n, "y") || y > hi(n, "y")) continue;
        if (!overlapsAny(n, x, y, i)) { n.x = x; n.y = y; break search; }
      }
    }
  }
  return nodes.map((n) => ({ id: n.id, x: Math.round(n.x - n.w / 2), y: Math.round(n.y - n.h / 2), w: n.w, h: n.h, tier: n.tier }));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
