"use client";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { HUE_TICKS, canvasHeight, curate, curatedCount, layoutScatter, type Placed, type ScatterInput } from "@/lib/colour-scatter";
import { formatPrice, imageAt } from "@/lib/format";
import { ArrowUpRight, CloseIcon } from "./icons";
import type { ColourItem } from "@/server/colour-data";

/* ------------------------------------------------------------------ helpers */

const hsl = (c: { h: number; s: number; l: number }) => `hsl(${c.h} ${c.s}% ${c.l}%)`;
const isWordPress = (url: string) => /\/wp-content\/uploads\//.test(url);

/**
 * Thumbnail sized for the piece. Shopify's CDN resizes on request (keeping the photo's own
 * proportions); WordPress (The ROK) keeps a square 300×300 thumbnail beside each upload.
 * If a derived thumbnail is missing, the piece falls back to the stored image, then to a swatch.
 */
function thumbFor(url: string, width: number): string {
  if (/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) return imageAt(url, width) ?? url;
  const m = url.match(/^(.*\/wp-content\/uploads\/.+?)(-scaled)?(\.(?:jpe?g|png|webp))$/i);
  return m ? `${m[1]}-300x300${m[3]}` : url;
}

/** Width/height: Shopify product photos are portrait (≈4:5); WordPress thumbnails are square. */
const aspectFor = (item: ColourItem) => (isWordPress(item.imageUrl) ? 1 : 0.8);

/** How much each size grows on hover — small pieces grow most. Read back by the info card via --lift. */
const LIFT = { s: 1.75, m: 1.45, l: 1.22 } as const;

/* -------------------------------------------------------- hover/selection store
   Outside React state, so hovering never re-renders the canvas. */
type Focus = { item: ColourItem; el: HTMLElement; pinned: boolean } | null;
function createFocusStore() {
  let focus: Focus = null;
  const subs = new Set<() => void>();
  return {
    get: () => focus,
    set: (f: Focus) => { focus = f; subs.forEach((s) => s()); },
    subscribe: (s: () => void) => { subs.add(s); return () => subs.delete(s); },
  };
}
type FocusStore = ReturnType<typeof createFocusStore>;

/* ------------------------------------------------------------------ point */

const Point = memo(function Point({ item, place, store, index }: { item: ColourItem; place: Placed; store: FocusStore; index: number }) {
  const [src, setSrc] = useState(() => thumbFor(item.imageUrl, place.tier === "l" ? 320 : 200));
  const [failed, setFailed] = useState(false);
  const pointer = useRef<string>("mouse");
  const price = formatPrice(item.price, item.currency);

  return (
    <a
      className="cx-pt"
      data-tier={place.tier}
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        width: place.w, height: place.h, background: hsl(item.colour),
        ["--x" as string]: `${place.x}px`, ["--y" as string]: `${place.y}px`, ["--lift" as string]: LIFT[place.tier],
        ["--i" as string]: Math.min(index, 60),
      }}
      aria-label={`${item.name} by ${item.brandName}${price ? `, ${price}` : ""} — opens ${item.brandName} in a new tab`}
      onPointerDown={(e) => { pointer.current = e.pointerType; }}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") store.set({ item, el: e.currentTarget, pinned: false }); }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse" && !store.get()?.pinned) store.set(null); }}
      onFocus={(e) => store.set({ item, el: e.currentTarget, pinned: false })}
      onBlur={() => { if (!store.get()?.pinned) store.set(null); }}
      onClick={(e) => {
        // Touch: first tap reveals details, second tap (or "Open") goes to the brand's page.
        if (pointer.current !== "mouse") {
          const f = store.get();
          if (!(f?.pinned && f.item.id === item.id)) {
            e.preventDefault();
            store.set({ item, el: e.currentTarget, pinned: true });
          }
        }
      }}
    >
      {!failed && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(e) => e.currentTarget.setAttribute("data-loaded", "")}
          onError={() => { if (src !== item.imageUrl) setSrc(item.imageUrl); else setFailed(true); }}
        />
      )}
    </a>
  );
});

/* ------------------------------------------------------- floating info card */

function InfoCard({ store, canvas }: { store: FocusStore; canvas: React.RefObject<HTMLDivElement | null> }) {
  const focus = useSyncExternalStore(store.subscribe, store.get, () => null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    canvas.current?.querySelectorAll(".cx-pt[data-active]").forEach((t) => t.removeAttribute("data-active"));
    if (focus?.pinned) focus.el.setAttribute("data-active", "");
  }, [focus, canvas]);

  useLayoutEffect(() => {
    if (!focus || !canvas.current || !ref.current) { setPos(null); return; }
    const host = canvas.current.getBoundingClientRect();
    // Position against the piece's *enlarged* footprint (it grows around its centre).
    const r = focus.el.getBoundingClientRect();
    const lift = Number(getComputedStyle(focus.el).getPropertyValue("--lift")) || 1.4;
    const ex = Math.max(0, (focus.el.offsetWidth * lift - r.width) / 2), ey = Math.max(0, (focus.el.offsetHeight * lift - r.height) / 2);
    const L = r.left - host.left - ex, R = r.right - host.left + ex, T = r.top - host.top - ey, B = r.bottom - host.top + ey;
    const card = ref.current.getBoundingClientRect();
    const W = host.width, cw = card.width, ch = card.height, gap = 14;
    const clampX = (x: number) => Math.max(0, Math.min(x, W - cw));
    const midY = (T + B) / 2 - ch / 2;
    let left: number, top: number;
    if (R + gap + cw <= W) { left = R + gap; top = midY; }
    else if (L - gap - cw >= 0) { left = L - gap - cw; top = midY; }
    else if (T - gap - ch >= 0) { left = clampX((L + R) / 2 - cw / 2); top = T - gap - ch; }
    else { left = clampX((L + R) / 2 - cw / 2); top = B + gap; }
    setPos({ left, top: Math.max(0, top) });
  }, [focus, canvas]);

  useEffect(() => {
    if (!focus) return;
    const onDoc = (e: PointerEvent) => {
      if (!focus.pinned) return;
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !focus.el.contains(t)) store.set(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") store.set(null); };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [focus, store]);

  if (!focus) return null;
  const { item, pinned } = focus;
  const price = formatPrice(item.price, item.currency);
  return (
    <div ref={ref} className="cx-card" data-pinned={pinned || undefined} role={pinned ? "dialog" : "tooltip"}
      aria-label={pinned ? `${item.name} details` : undefined}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
      <span className="card__brand">{item.brandName}</span>
      <span className="cx-card__name">{item.name}</span>
      <span className="cx-card__meta">
        {price ? <span>{price}</span> : <span className="muted">Price on site</span>}
        <span className="cx-card__shade"><i style={{ background: hsl(item.colour) }} />{item.colour.term}</span>
      </span>
      {pinned && (
        <span className="cx-card__actions">
          <a className="btn btn--sm btn--solid" href={item.url} target="_blank" rel="noopener noreferrer">
            Open on {item.brandName} <ArrowUpRight width={12} height={12} />
          </a>
          <button className="icon-btn" onClick={() => store.set(null)} aria-label="Close details"><CloseIcon /></button>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ axes */

function Axes({ width, height }: { width: number; height: number }) {
  const midX = width / 2, midY = height / 2;
  return (
    <div className="cx-axes" aria-hidden>
      <i className="cx-axis cx-axis--x" style={{ top: midY }} />
      <i className="cx-axis cx-axis--y" style={{ left: midX }} />
      {/* Hue spectrum along the horizontal axis: colour dots only, no text */}
      {HUE_TICKS.map((t) => (
        <span key={t.label} className="cx-tick" style={{ left: t.x * width, top: midY }}>
          <i style={{ background: `hsl(${t.h} 70% 55%)` }} />
        </span>
      ))}
      <span className="cx-tick cx-tick--neutral" style={{ left: midX, top: midY }}><i /></span>
      {/* Lightness along the vertical axis */}
      <span className="cx-pole cx-pole--top" style={{ left: midX }}>Lighter</span>
      <span className="cx-pole cx-pole--bottom" style={{ left: midX }}>Deeper</span>
      {/* Quadrant names, tucked into the corners */}
      <span className="cx-quad" style={{ left: 0, top: 0 }}>Light · warm</span>
      <span className="cx-quad" style={{ right: 0, top: 0 }}>Light · cool</span>
      <span className="cx-quad" style={{ left: 0, bottom: 0 }}>Deep · warm</span>
      <span className="cx-quad" style={{ right: 0, bottom: 0 }}>Deep · cool</span>
    </div>
  );
}

/* ------------------------------------------------------------- the canvas */

const Points = memo(function Points({ items, placed, store }: { items: Map<string, ColourItem>; placed: Placed[]; store: FocusStore }) {
  return <>{placed.map((p, i) => <Point key={p.id} item={items.get(p.id)!} place={p} store={store} index={i} />)}</>;
});

export function ColourExplorer({ items, considered, signedIn }: { items: ColourItem[]; considered: number; signedIn: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(0);            // 0 = not measured yet
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const store = useMemo(createFocusStore, []);

  // Canvas width follows the page; layout recomputes on resize only (never on mouse movement).
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inputs = useMemo(() => items.map((it) => ({ ...it, aspect: aspectFor(it) })), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const narrow = width > 0 && width < 560;
  const curatedN = width ? curatedCount(width, narrow ? 1.7 : 0.95) : 0;
  const visible: (ScatterInput & ColourItem)[] = useMemo(() => {
    if (!width) return [];
    return showAll ? inputs : curate(inputs, curatedN);
  }, [inputs, showAll, curatedN, width]);

  const height = useMemo(() => (width ? canvasHeight(visible, width, Math.round(width * (narrow ? 1.25 : 0.62))) : 0), [visible, width, narrow]);
  const placed = useMemo(() => (width ? layoutScatter(visible, width, height) : []), [visible, width, height]);

  useEffect(() => store.set(null), [showAll, width, store]);

  if (!items.length) {
    return (
      <div className="empty">
        <div className="empty__sq" aria-hidden><i style={{ background: "var(--orange)" }} /><i style={{ background: "var(--lime)" }} /><i style={{ background: "var(--lavender)" }} /></div>
        <h3>No colours to explore yet</h3>
        <p>{signedIn ? "Follow a few brands and their clothes will appear here, mapped by shade." : "There's nothing in the preview right now."}</p>
        {signedIn && <Link className="btn btn--ghost" href="/brands">Add brands</Link>}
      </div>
    );
  }

  const canCurate = items.length > curatedN;
  return (
    <div className="cx">
      <div className="cx-bar meta" aria-live="polite">
        <span>
          {canCurate && !showAll ? `A curated ${visible.length} of ${items.length} pieces, spread across the colour map` : `All ${items.length} pieces`}
        </span>
        {canCurate && (
          <button className="link" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show a curated selection" : `Show all ${items.length}`}</button>
        )}
      </div>

      <div ref={stage} className="cx-stage">
        {width > 0 ? (
          <div ref={canvas} className="cx-canvas" style={{ height }}
            onPointerLeave={() => { if (!store.get()?.pinned) store.set(null); }}>
            <Axes width={width} height={height} />
            <Points items={byId} placed={placed} store={store} />
            <InfoCard store={store} canvas={canvas} />
          </div>
        ) : <div className="cx-placeholder" />}
      </div>

      <p className="meta cx-note">
        Across: the colour spectrum, with softer, muted shades drawn toward the centre and neutrals on the centre line. Down: light to deep.
        Shades are read from how each brand names its products, so pieces without a colour in their name aren’t placed yet
        ({items.length.toLocaleString("en-IN")} of {considered.toLocaleString("en-IN")} garments).
      </p>
    </div>
  );
}
