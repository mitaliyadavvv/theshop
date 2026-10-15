"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./Modal";
import { SearchIcon, CloseIcon, ArrowUpRight } from "./icons";
import { formatPrice, imageAt } from "@/lib/format";
import type { CatalogResult, ProductDTO } from "@/lib/types";

const SUGGESTIONS = ["tops", "silver earrings", "linen trousers", "dresses", "co-ord set", "skirts"];

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ items: ProductDTO[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const router = useRouter();
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) { setRes(null); return; }
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/products?q=${encodeURIComponent(term)}&limit=6`);
        const data = (await r.json()) as CatalogResult;
        if (id === reqId.current) { setRes({ items: data.items, total: data.total }); setActive(-1); }
      } catch { if (id === reqId.current) setRes({ items: [], total: 0 }); }
      finally { if (id === reqId.current) setLoading(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const seeAll = (term = q) => {
    onClose();
    router.push(`/?q=${encodeURIComponent(term.trim())}#catalogue`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const n = res?.items.length ?? 0;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); setActive((a) => (a <= 0 ? n - 1 : a - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && res?.items[active]) window.open(res.items[active].url, "_blank", "noopener");
      else if (q.trim()) seeAll();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Search the catalogue" labelledHidden>
      <div className="search-box">
        <SearchIcon width={18} height={18} />
        <label htmlFor="global-search" className="sr-only">Search products and brands</label>
        <input id="global-search" data-autofocus autoComplete="off" placeholder="Search tops, earrings, a brand…"
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          role="combobox" aria-expanded={!!res?.items.length} aria-controls="search-results"
          aria-activedescendant={active >= 0 ? `sr-${active}` : undefined} />
        <button className="icon-btn" onClick={onClose} aria-label="Close search"><CloseIcon /></button>
      </div>
      {!q.trim() && (
        <div className="search-suggest">
          <span className="meta" style={{ width: "100%" }}>Try</span>
          {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => setQ(s)}>{s}</button>)}
        </div>
      )}
      {q.trim() && res && (
        res.items.length ? (
          <ul id="search-results" className="search-results" role="listbox">
            {res.items.map((p, i) => (
              <li key={p.id} role="option" id={`sr-${i}`} aria-selected={i === active}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" data-active={i === active}>
                  {p.imageUrl ? <img src={imageAt(p.imageUrl, 120)!} alt="" loading="lazy" /> : <span className="thumb-ph" />}
                  <span style={{ minWidth: 0 }}>
                    <span className="meta" style={{ textTransform: "uppercase", display: "block" }}>{p.brandName}</span>
                    <span className="search-results__name">{p.name}</span>
                  </span>
                  <span className="meta" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{formatPrice(p.price, p.currency)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="search-suggest"><p className="muted">No products match “{q.trim()}”. Try a broader word, like “top” or a brand name.</p></div>
        )
      )}
      {q.trim() && (
        <div className="search-foot">
          <span className="meta" aria-live="polite">{loading ? "Searching…" : res ? `${res.total.toLocaleString("en-IN")} result${res.total === 1 ? "" : "s"} across all brands` : ""}</span>
          <button className="btn btn--sm" onClick={() => seeAll()} disabled={!res?.total}>See all results <ArrowUpRight width={12} height={12} /></button>
        </div>
      )}
    </Modal>
  );
}
