"use client";
import { useEffect } from "react";
import { site } from "@/config/site";
import { imageAt } from "@/lib/format";
import type { ProductDTO } from "@/lib/types";

/* Collage slots (desktop). fx/fy = direction each photo drifts in from. */
const SLOTS: { pos: React.CSSProperties; w: string; fx: string; fy: string; d: number }[] = [
  { pos: { left: "3%", top: "12%" }, w: "11.5%", fx: "-48px", fy: "8px", d: 60 },
  { pos: { left: "16.5%", top: "56%" }, w: "8.5%", fx: "-24px", fy: "36px", d: 160 },
  { pos: { left: "19%", top: "7%" }, w: "7%", fx: "0px", fy: "-36px", d: 240 },
  { pos: { right: "3.5%", top: "9%" }, w: "11%", fx: "48px", fy: "0px", d: 110 },
  { pos: { right: "17%", top: "55%" }, w: "9.5%", fx: "28px", fy: "36px", d: 200 },
  { pos: { right: "18.5%", top: "5%" }, w: "6.5%", fx: "0px", fy: "-36px", d: 290 },
];

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
  useEffect(() => {
    document.cookie = "hero_played=1; path=/; SameSite=Lax"; // session cookie: no expiry
  }, []);

  return (
    <section className="hero" data-animate="true" aria-labelledby="hero-title">
      <div className="hero__stage">
        <div className="hero__photos">
          {photos.map((p, i) => {
            const slot = SLOTS[i];
            if (!slot || !p.imageUrl) return null;
            return (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="hero__photo"
                style={{ ...slot.pos, width: slot.w, aspectRatio: "3 / 4", ["--fx" as string]: slot.fx, ["--fy" as string]: slot.fy, ["--d" as string]: `${slot.d}ms` }}
                aria-label={`${p.name} by ${p.brandName}`}>
                <img src={imageAt(p.imageUrl, 400)!} alt="" loading="eager" />
                <figcaption>{p.brandName}</figcaption>
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
