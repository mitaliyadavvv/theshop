"use client";
import { useEffect, useRef } from "react";
import { site } from "@/config/site";
import { imageAt } from "@/lib/format";
import type { ProductDTO } from "@/lib/types";

/* Collage slots (desktop). fx/fy = direction each photo drifts in from.
   depth = max parallax travel in px (bigger photos read as closer, so they move more). */
const SLOTS: { pos: React.CSSProperties; w: string; fx: string; fy: string; d: number; depth: number }[] = [
  { pos: { left: "3%", top: "12%" }, w: "11.5%", fx: "-48px", fy: "8px", d: 60, depth: 12 },
  { pos: { left: "16.5%", top: "56%" }, w: "8.5%", fx: "-24px", fy: "36px", d: 160, depth: 8 },
  { pos: { left: "19%", top: "7%" }, w: "7%", fx: "0px", fy: "-36px", d: 240, depth: 6 },
  { pos: { right: "3.5%", top: "9%" }, w: "11%", fx: "48px", fy: "0px", d: 110, depth: 11 },
  { pos: { right: "17%", top: "55%" }, w: "9.5%", fx: "28px", fy: "36px", d: 200, depth: 9 },
  { pos: { right: "18.5%", top: "5%" }, w: "6.5%", fx: "0px", fy: "-36px", d: 290, depth: 5 },
];

/** Fraction of the remaining distance covered per 60 Hz frame: lower = softer, more delayed.
    Scaled by real elapsed time, so it glides the same on 60 Hz and 120 Hz screens (~0.6 s to settle). */
const EASE = 0.075;

/**
 * Mouse parallax for the hero photos. Writes transforms straight to the DOM from a
 * requestAnimationFrame loop — no React state, so no re-renders while the mouse moves.
 * Only on fine-pointer, hover-capable screens wider than the mobile layout, and never
 * with prefers-reduced-motion. The loop stops itself once everything has settled.
 */
function useHeroParallax(stage: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 761px) and (prefers-reduced-motion: no-preference)");
    const layers = () => [...el.querySelectorAll<HTMLElement>("[data-depth]")];
    let target = { x: 0, y: 0 }, current = { x: 0, y: 0 }, raf = 0, last = 0;

    const paint = (now: number) => {
      const dt = last ? Math.min(now - last, 100) : 16.7;
      last = now;
      const k = 1 - Math.pow(1 - EASE, dt / 16.7);
      current.x += (target.x - current.x) * k;
      current.y += (target.y - current.y) * k;
      const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
      if (settled) current = { ...target };
      for (const l of layers()) {
        const d = Number(l.dataset.depth) || 0;
        l.style.transform = current.x || current.y ? `translate3d(${(current.x * d).toFixed(2)}px, ${(current.y * d).toFixed(2)}px, 0)` : "";
      }
      raf = settled ? 0 : requestAnimationFrame(paint);
      if (settled) last = 0;
    };
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(paint); } };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      // Cursor relative to the hero centre, clamped to -1…1 on each axis.
      target = {
        x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)),
        y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)),
      };
      kick();
    };
    const onLeave = () => { target = { x: 0, y: 0 }; kick(); };   // glide back home

    const enable = () => { el.addEventListener("pointermove", onMove); el.addEventListener("pointerleave", onLeave); };
    const disable = () => {
      el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf); raf = 0;
      target = { x: 0, y: 0 }; current = { x: 0, y: 0 };
      for (const l of layers()) l.style.transform = "";
    };
    // Re-evaluate when the window crosses the breakpoint or the motion setting changes.
    const onChange = () => { disable(); if (mq.matches) enable(); };
    onChange();
    mq.addEventListener("change", onChange);
    return () => { mq.removeEventListener("change", onChange); disable(); };
  }, [stage]);
}

const SQUARES: { style: React.CSSProperties; c: string; s: number; float?: boolean; desk?: boolean; d: number }[] = [
  { style: { left: "14%", top: "40%" }, c: "var(--orange)", s: 12, float: true, d: 760 },
  { style: { left: "29%", top: "24%" }, c: "var(--lime)", s: 9, d: 820, desk: true },
  { style: { left: "9%", top: "80%" }, c: "var(--lavender)", s: 14, float: true, d: 880 },
  { style: { right: "13%", top: "40%" }, c: "var(--cobalt)", s: 10, float: true, d: 790 },
  { style: { right: "29%", top: "78%" }, c: "var(--pink)", s: 13, d: 900, desk: true },
  { style: { right: "8%", top: "84%" }, c: "var(--lime)", s: 8, d: 950 },
  { style: { left: "48%", top: "9%" }, c: "var(--pink)", s: 7, float: true, d: 990, desk: true },
];

type Stats = { products: number; brands: number; newThisWeek: number };

export function Hero({ photos, stats }: { photos: ProductDTO[]; stats: Stats }) {
  const stage = useRef<HTMLDivElement>(null);
  useHeroParallax(stage);
  useEffect(() => {
    document.cookie = "hero_played=1; path=/; SameSite=Lax"; // session cookie: no expiry
  }, []);

  return (
    <section className="hero" data-animate="true" aria-labelledby="hero-title">
      <div className="hero__stage" ref={stage}>
        <div className="hero__photos">
          {photos.map((p, i) => {
            const slot = SLOTS[i];
            if (!slot || !p.imageUrl) return null;
            return (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="hero__photo"
                style={{ ...slot.pos, width: slot.w, aspectRatio: "3 / 4", ["--fx" as string]: slot.fx, ["--fy" as string]: slot.fy, ["--d" as string]: `${slot.d}ms` }}
                aria-label={`${p.name} by ${p.brandName}`}>
                {/* Inner layer carries the parallax, so the frame's entrance animation and hover lift keep their own transform. */}
                <span className="hero__drift" data-depth={slot.depth}>
                  <img src={imageAt(p.imageUrl, 400)!} alt="" loading="eager" decoding="async" fetchPriority={i < 2 ? "high" : "auto"} />
                  <figcaption>{p.brandName}</figcaption>
                </span>
              </a>
            );
          })}
        </div>
        {SQUARES.map((q, i) => (
          <span key={i} aria-hidden className={`hero__sq${q.float ? " hero__sq--float" : ""}${q.desk ? " hero__sq--desk" : ""}`}
            style={{ ...q.style, width: q.s, height: q.s, background: q.c, ["--d" as string]: `${q.d}ms` }} />
        ))}
        <div className="hero__copy">
          <h1 id="hero-title">{site.heroTitle}</h1>
          <p className="hero__sub">{site.heroSub}</p>
          <p className="hero__stats meta">
            <span><i style={{ background: "var(--cobalt)" }} />{stats.products.toLocaleString("en-IN")} products</span>
            <span><i style={{ background: "var(--orange)" }} />{stats.brands} brands</span>
            <span><i style={{ background: "var(--lime)" }} />{stats.newThisWeek} new this week</span>
          </p>
          <div className="hero__cta"><a href="#catalogue" className="btn">Start browsing</a></div>
        </div>
      </div>
    </section>
  );
}
