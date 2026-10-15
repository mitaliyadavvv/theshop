"use client";
import { useState } from "react";
import { Catalogue } from "./Catalogue";
import type { Option } from "./Dropdown";
import { formatDate } from "@/lib/dates";
import { imageAt } from "@/lib/format";
import type { CatalogQuery, CatalogResult, CollectionDTO, DropWindow } from "@/lib/types";

const WINDOWS: { id: DropWindow; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "recent", label: "All recent drops" },
];

export function NewDrops({ window: initialWindow, initial, initialQuery, collections, cutoffs, categories, brands, newDropDays }: {
  window: DropWindow; initial: CatalogResult; initialQuery: CatalogQuery; collections: CollectionDTO[];
  cutoffs: Record<DropWindow, string>; categories: Option[]; brands: Option[]; newDropDays: number;
}) {
  const [win, setWin] = useState(initialWindow);
  const [first, setFirst] = useState(true);
  const cols = collections.filter((c) => c.publishedAt >= cutoffs[win]);

  const pick = (w: DropWindow) => {
    setWin(w); setFirst(false);
    const u = new URL(window.location.href);
    u.searchParams.set("drop", w);
    window.history.replaceState(null, "", u);
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button key={w.id} role="tab" aria-selected={win === w.id} onClick={() => pick(w.id)}>{w.label}</button>
        ))}
      </div>

      {cols.length > 0 && (
        <section aria-labelledby="new-collections">
          <h2 id="new-collections" className="section-title">New collections <span className="meta">{cols.length}</span></h2>
          <div className="collections">
            {cols.map((c) => (
              <a key={c.id} className="collection" href={c.url} target="_blank" rel="noopener noreferrer">
                <div className="collection__img">{c.imageUrl && <img src={imageAt(c.imageUrl, 500)!} alt="" loading="lazy" />}</div>
                <span className="card__brand">{c.brandName}</span>
                <span className="collection__title">{c.title}</span>
                <span className="card__date">Published {formatDate(c.publishedAt)}{c.productsCount ? ` · ${c.productsCount} pieces` : ""}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <h2 className="section-title" style={{ marginBottom: 0 }}>New products</h2>
      {/* Remount per window: the window is fixed for that catalogue instance. Server data covers the first window only. */}
      <Catalogue key={win} initial={first ? initial : { ...initial, items: [], total: 0 }} initialQuery={first ? initialQuery : { sort: "newest" }}
        fixed={{ drop: win }} categories={categories} brands={brands} newDropDays={newDropDays} forceInitialLoad={!first}
        emptyHint={win === "today" ? "No brand has published anything yet today. Try “This week”." : "No new products from your brands in this window."} />
    </>
  );
}
