import type { CatalogQuery } from "./types";

/** CatalogQuery -> URLSearchParams (inverse of server/query-params.ts). */
export function toSearchParams(q: CatalogQuery, opts: { includePaging?: boolean } = {}) {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.categories?.length) p.set("category", q.categories.join(","));
  if (q.brands?.length) p.set("brand", q.brands.join(","));
  if (q.sort) p.set("sort", q.sort);
  if (q.minPrice != null) p.set("min", String(q.minPrice));
  if (q.maxPrice != null) p.set("max", String(q.maxPrice));
  if (q.inStock) p.set("stock", "1");
  if (q.onSale) p.set("sale", "1");
  if (q.savedOnly) p.set("saved", "1");
  if (q.newOnly) p.set("new", "1");
  if (q.drop) p.set("drop", q.drop);
  if (opts.includePaging) {
    if (q.page && q.page > 1) p.set("page", String(q.page));
    if (q.limit) p.set("limit", String(q.limit));
  }
  return p;
}
