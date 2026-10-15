"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown, type Option } from "./Dropdown";
import { ProductCard, SkeletonGrid } from "./ProductCard";
import { Modal } from "./Modal";
import { CloseIcon, SearchIcon, SlidersIcon } from "./icons";
import { toSearchParams } from "@/lib/query-string";
import { formatPrice } from "@/lib/format";
import type { CatalogQuery, CatalogResult, ProductDTO, SortKey } from "@/lib/types";

type Props = {
  initial: CatalogResult;
  initialQuery: CatalogQuery;
  categories: Option[];        // global list (with counts) for the headline picker
  brands: Option[];
  /** Params the page controls and the user can't clear here (e.g. saved-only, drop window). */
  fixed?: Partial<CatalogQuery>;
  heading?: "lookfor" | "none";
  emptyHint?: React.ReactNode;
  newDropDays: number;
  /** Fetch on mount instead of trusting `initial` (used when switching tabs client-side). */
  forceInitialLoad?: boolean;
};

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest", relevance: "Best match", price_asc: "Price: low to high", price_desc: "Price: high to low", brand: "Brand A–Z",
};

const PRICE_PRESETS = [
  { label: "Under ₹1,500", min: null, max: 1500 },
  { label: "₹1,500 – ₹3,000", min: 1500, max: 3000 },
  { label: "₹3,000 – ₹5,000", min: 3000, max: 5000 },
  { label: "Over ₹5,000", min: 5000, max: null },
];

const pickerLabel = (sel: string[], opts: Option[], any: string, plural: string) =>
  sel.length === 0 ? any : sel.length === 1 ? opts.find((o) => o.id === sel[0])?.label ?? any : `${sel.length} ${plural}`;

export function Catalogue({ initial, initialQuery, categories, brands, fixed = {}, heading = "none", emptyHint, newDropDays, forceInitialLoad }: Props) {
  const [query, setQuery] = useState<CatalogQuery>(() => ({ ...initialQuery, ...fixed }));
  const [qInput, setQInput] = useState(initialQuery.q ?? "");
  const [data, setData] = useState<CatalogResult>(initial);
  const [items, setItems] = useState<ProductDTO[]>(initial.items);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">(forceInitialLoad ? "loading" : "idle");
  const [pulse, setPulse] = useState(false);
  const [sheet, setSheet] = useState(false);
  const first = useRef(true);
  const reqId = useRef(0);

  // Debounce typing into the query.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q ?? "") === qInput.trim() ? q : { ...q, q: qInput.trim() || undefined, sort: q.sort === "relevance" && !qInput.trim() ? undefined : q.sort }), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async (q: CatalogQuery, page: number) => {
    const id = ++reqId.current;
    setStatus(page > 1 ? "more" : "loading");
    try {
      const params = toSearchParams({ ...q, page, limit: initial.pageSize }, { includePaging: true });
      const res = await fetch(`/api/products?${params}`);
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as CatalogResult;
      if (id !== reqId.current) return;
      setData(next);
      setItems((prev) => (page > 1 ? [...prev, ...next.items.filter((n) => !prev.some((p) => p.id === n.id))] : next.items));
      setStatus("idle");
      if (page === 1) { setPulse(true); setTimeout(() => setPulse(false), 700); }
    } catch {
      if (id === reqId.current) setStatus("error");
    }
  }, [initial.pageSize]);

  // Fetch + reflect state in the URL whenever filters change (not on first render — SSR already did it).
  useEffect(() => {
    if (first.current) { first.current = false; if (!forceInitialLoad) return; }
    load(query, 1);
    // Rewrite only the params this component owns; leave page-owned ones (e.g. drop) alone.
    const visible = { ...query };
    for (const k of Object.keys(fixed) as (keyof CatalogQuery)[]) delete visible[k];
    const owned = toSearchParams({ ...fixed });
    const url = new URL(window.location.href);
    for (const k of [...url.searchParams.keys()]) if (!owned.has(k)) url.searchParams.delete(k);
    toSearchParams(visible).forEach((v, k) => url.searchParams.set(k, v));
    window.history.replaceState(null, "", url);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<CatalogQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const clearAll = () => { setQInput(""); setQuery({ ...fixed }); };

  const catFacet: Option[] = useMemo(() => data.facets.categories.map((c) => ({ id: c.id, label: c.label, count: c.count })), [data]);
  const brandFacet: Option[] = useMemo(() => {
    const counts = new Map(data.facets.brands.map((b) => [b.id, b.count]));
    return brands.map((b) => ({ id: b.id, label: b.label, count: counts.get(b.id) ?? 0 }));
  }, [data, brands]);

  const sel = { cats: query.categories ?? [], brands: query.brands ?? [] };
  const priceActive = query.minPrice != null || query.maxPrice != null;
  const advancedCount = [query.inStock, query.onSale, query.newOnly && !fixed.newOnly, query.savedOnly && !fixed.savedOnly].filter(Boolean).length;

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (query.q) chips.push({ key: "q", label: `“${query.q}”`, clear: () => { setQInput(""); set({ q: undefined }); } });
  for (const c of sel.cats) chips.push({ key: `c-${c}`, label: categories.find((o) => o.id === c)?.label ?? c, clear: () => set({ categories: sel.cats.filter((x) => x !== c) }) });
  for (const b of sel.brands) chips.push({ key: `b-${b}`, label: brands.find((o) => o.id === b)?.label ?? b, clear: () => set({ brands: sel.brands.filter((x) => x !== b) }) });
  if (priceActive) chips.push({ key: "price", label: `${query.minPrice != null ? formatPrice(query.minPrice, "INR") : "Any"} – ${query.maxPrice != null ? formatPrice(query.maxPrice, "INR") : "any"}`, clear: () => set({ minPrice: null, maxPrice: null }) });
  if (query.inStock) chips.push({ key: "stock", label: "In stock", clear: () => set({ inStock: false }) });
  if (query.onSale) chips.push({ key: "sale", label: "On sale", clear: () => set({ onSale: false }) });
  if (query.newOnly && !fixed.newOnly) chips.push({ key: "new", label: `New in ${newDropDays} days`, clear: () => set({ newOnly: false }) });
  if (query.savedOnly && !fixed.savedOnly) chips.push({ key: "saved", label: "Saved", clear: () => set({ savedOnly: false }) });

  const sortOptions: Option[] = (Object.keys(SORT_LABELS) as SortKey[])
    .filter((k) => k !== "relevance" || query.q).map((k) => ({ id: k, label: SORT_LABELS[k] }));

  const pricePanel = (close?: () => void) => (
    <div className="dd__panel">
      <div key={`${query.minPrice}-${query.maxPrice}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label className="field"><span>Min ₹</span>
          <input className="input" inputMode="numeric" placeholder={data.facets.price.min != null ? String(Math.floor(data.facets.price.min)) : "0"}
            defaultValue={query.minPrice ?? ""} onBlur={(e) => set({ minPrice: e.target.value ? Number(e.target.value) || 0 : null })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
        <label className="field"><span>Max ₹</span>
          <input className="input" inputMode="numeric" placeholder={data.facets.price.max != null ? String(Math.ceil(data.facets.price.max)) : ""}
            defaultValue={query.maxPrice ?? ""} onBlur={(e) => set({ maxPrice: e.target.value ? Number(e.target.value) || 0 : null })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {PRICE_PRESETS.map((p) => (
          <button key={p.label} type="button" className="chip" data-active={query.minPrice === p.min && query.maxPrice === p.max}
            onClick={() => { set({ minPrice: p.min, maxPrice: p.max }); close?.(); }}>{p.label}</button>
        ))}
      </div>
      <p className="meta">Prices as listed by each brand, in their own currency (INR for current brands).</p>
    </div>
  );

  const advanced = (
    <>
      <label className="check"><input type="checkbox" checked={!!query.inStock} onChange={(e) => set({ inStock: e.target.checked })} />In stock only</label>
      <label className="check"><input type="checkbox" checked={!!query.onSale} onChange={(e) => set({ onSale: e.target.checked })} />On sale (brand-marked)</label>
      {!fixed.drop && !fixed.newOnly && <label className="check"><input type="checkbox" checked={!!query.newOnly} onChange={(e) => set({ newOnly: e.target.checked })} />New in the last {newDropDays} days</label>}
      {!fixed.savedOnly && <label className="check"><input type="checkbox" checked={!!query.savedOnly} onChange={(e) => set({ savedOnly: e.target.checked })} />Saved items only</label>}
    </>
  );

  const shown = status === "loading" && items.length === 0;

  return (
    <div>
      {heading === "lookfor" && (
        <h2 className="lookfor">
          <span className="lookfor__line">
            <span className="lookfor__muted">I’m looking for</span>
            <Dropdown variant="text" ariaLabel="Category" trigger={pickerLabel(sel.cats, categories, "any category", "categories").toLowerCase()}
              options={categories} selected={sel.cats} allLabel="Any category" onChange={(ids) => set({ categories: ids })} />
          </span>
          <span className="lookfor__line">
            <span className="lookfor__muted">from</span>
            <Dropdown variant="text" ariaLabel="Brand" trigger={pickerLabel(sel.brands, brands, "all brands", "brands")}
              options={brands} selected={sel.brands} allLabel="All brands" onChange={(ids) => set({ brands: ids })} />
          </span>
        </h2>
      )}

      <div className="toolbar">
        <div className="toolbar__row">
          <div className="toolbar__search">
            <SearchIcon width={14} height={14} />
            <label className="sr-only" htmlFor="catalogue-q">Search the catalogue</label>
            <input id="catalogue-q" className="input" type="search" placeholder="Search all products" value={qInput} onChange={(e) => setQInput(e.target.value)} />
          </div>
          <div className="toolbar__desktop" style={{ display: "contents" }}>
            <Dropdown ariaLabel="Category filter" trigger="Category" multi options={catFacet} selected={sel.cats} allLabel="Any category"
              active={sel.cats.length > 0} badge={sel.cats.length} onChange={(ids) => set({ categories: ids })} />
            <Dropdown ariaLabel="Brand filter" trigger="Brand" multi options={brandFacet} selected={sel.brands} allLabel="All brands"
              active={sel.brands.length > 0} badge={sel.brands.length} onChange={(ids) => set({ brands: ids })} />
            <Dropdown ariaLabel="Price filter" trigger="Price" active={priceActive} panel={(close) => pricePanel(close)} />
            <button className="chip" data-active={advancedCount > 0 || undefined} onClick={() => setSheet(true)}>
              <SlidersIcon width={12} height={12} /> Filters {advancedCount > 0 && <span className="chip__badge">{advancedCount}</span>}
            </button>
          </div>
          <div className="toolbar__mobile">
            <button className="chip" onClick={() => setSheet(true)} data-active={chips.length > (query.q ? 1 : 0) || undefined}>
              <SlidersIcon width={12} height={12} /> Filters {chips.filter((c) => c.key !== "q").length > 0 && <span className="chip__badge">{chips.filter((c) => c.key !== "q").length}</span>}
            </button>
          </div>
          <div className="toolbar__count meta" aria-live="polite">
            <span><span className="count-pulse" data-on={pulse} aria-hidden /> <span className="count-num">{data.total.toLocaleString("en-IN")}</span> product{data.total === 1 ? "" : "s"}</span>
            <Dropdown ariaLabel="Sort order" align="right" trigger={<>Sort: {SORT_LABELS[data.sort]}</>} options={sortOptions}
              selected={[data.sort]} allLabel={query.q ? "Best match" : "Newest"} onChange={(ids) => set({ sort: (ids[0] as SortKey) || undefined })} />
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="active-filters" aria-label="Active filters">
          {chips.map((c) => (
            <span key={c.key} className="tag-chip">{c.label}<button aria-label={`Remove filter ${c.label}`} onClick={c.clear}><CloseIcon width={11} height={11} /></button></span>
          ))}
          <button className="clear-all" onClick={clearAll}>Clear all</button>
        </div>
      )}

      {status === "error" && (
        <div className="notice notice--error" style={{ marginTop: 24 }} role="alert"><i />
          <span>Couldn’t load products. <button className="link" onClick={() => load(query, 1)}>Try again</button></span>
        </div>
      )}

      {shown ? <SkeletonGrid /> : items.length > 0 ? (
        <div className="grid" data-loading={status === "loading"} aria-busy={status === "loading"}>
          {items.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 4} />)}
        </div>
      ) : status !== "error" && (
        <div className="empty">
          <div className="empty__sq" aria-hidden><i style={{ background: "var(--orange)" }} /><i style={{ background: "var(--lime)" }} /><i style={{ background: "var(--lavender)" }} /></div>
          <h3>{query.q ? `Nothing for “${query.q}” yet` : "Nothing matches these filters"}</h3>
          <p>{emptyHint ?? (query.q ? "Try a broader word (“top” instead of “halter crop top”), check the spelling, or search a brand name." : "Try removing a filter or two.")}</p>
          {chips.length > 0 && <button className="btn btn--ghost" onClick={clearAll}>Clear all filters</button>}
        </div>
      )}

      {data.hasMore && items.length > 0 && (
        <div className="load-more">
          <button className="btn btn--ghost" onClick={() => load(query, Math.floor(items.length / data.pageSize) + 1)} disabled={status === "more"}>
            {status === "more" ? "Loading…" : `Show more · ${(data.total - items.length).toLocaleString("en-IN")} left`}
          </button>
        </div>
      )}

      <Modal open={sheet} onClose={() => setSheet(false)} title="Filters" kind="sheet"
        footer={<><button className="btn btn--ghost" onClick={clearAll}>Clear all</button>
          <button className="btn btn--solid" onClick={() => setSheet(false)}>Show {data.total.toLocaleString("en-IN")} products</button></>}>
        <section className="sheet-mobile-only"><h3>Sort</h3>
          {sortOptions.map((o) => (
            <label key={o.id} className="check"><input type="radio" name="sort" checked={data.sort === o.id} onChange={() => set({ sort: o.id as SortKey })} />{o.label}</label>
          ))}
        </section>
        <section className="sheet-mobile-only"><h3>Category</h3>
          {catFacet.map((o) => (
            <label key={o.id} className="check"><input type="checkbox" checked={sel.cats.includes(o.id)}
              onChange={(e) => set({ categories: e.target.checked ? [...sel.cats, o.id] : sel.cats.filter((x) => x !== o.id) })} />
              {o.label}<span className="dd__count">{o.count}</span></label>
          ))}
        </section>
        <section className="sheet-mobile-only"><h3>Brand</h3>
          {brandFacet.map((o) => (
            <label key={o.id} className="check"><input type="checkbox" checked={sel.brands.includes(o.id)}
              onChange={(e) => set({ brands: e.target.checked ? [...sel.brands, o.id] : sel.brands.filter((x) => x !== o.id) })} />
              {o.label}<span className="dd__count">{o.count}</span></label>
          ))}
        </section>
        <section className="sheet-mobile-only"><h3>Price</h3>{pricePanel()}</section>
        <section><h3>Refine</h3>{advanced}</section>
      </Modal>
    </div>
  );
}
