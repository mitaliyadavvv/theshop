import type { CatalogQuery, DropWindow, SortKey } from "@/lib/types";

const SORTS: SortKey[] = ["newest", "relevance", "price_asc", "price_desc", "brand"];
const DROPS: DropWindow[] = ["today", "week", "month", "recent"];

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

/** Parse catalogue filters from a URL (API route or page searchParams). */
export function parseCatalogQuery(input: Params): CatalogQuery {
  const get = (k: string): string | undefined => {
    if (input instanceof URLSearchParams) return input.get(k) ?? undefined;
    const v = input[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const list = (k: string) => get(k)?.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
  const num = (k: string) => { const v = get(k); if (!v) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const sort = get("sort") as SortKey | undefined;
  const drop = get("drop") as DropWindow | undefined;
  return {
    q: get("q")?.slice(0, 120) || undefined,
    categories: list("category"),
    brands: list("brand"),
    sort: sort && SORTS.includes(sort) ? sort : undefined,
    minPrice: num("min"),
    maxPrice: num("max"),
    inStock: get("stock") === "1",
    onSale: get("sale") === "1",
    savedOnly: get("saved") === "1",
    newOnly: get("new") === "1",
    drop: drop && DROPS.includes(drop) ? drop : null,
    page: Math.min(Number(get("page")) || 1, 500),
    limit: Number(get("limit")) || 48,
  };
}
