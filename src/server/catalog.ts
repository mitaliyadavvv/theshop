import "server-only";
import { iso, withViewer, type Queryable, type Viewer } from "./db";
import { CATEGORIES } from "@/lib/categories";
import { dropCutoff } from "@/lib/dates";
import { inferCategory } from "./ingest/normalize";
import { checkRateLimit } from "./rate-limit";
import { diversify } from "@/lib/diversify";
import type { CatalogQuery, CatalogResult, CollectionDTO, ProductDTO, SortKey } from "@/lib/types";

const MAX_LIMIT = 96;
/** Upper bound on the ranked id list that brand mixing works over (far above today's catalogue). */
const MIX_CAP = 5000;
/** Signed-out visitors get a preview: this many pages of the public-preview brands. */
export const PREVIEW_PAGES = 2;
export const newDropDays = () => Number(process.env.NEW_DROP_DAYS ?? 14);
const demoOn = () => process.env.DEMO_MODE === "on";

/** Small, explicit synonym list. Plain keyword search — not semantic. */
const SYNONYMS: Record<string, string[]> = {
  pant: ["trouser"], pants: ["trousers"], trouser: ["pant"], trousers: ["pants"],
  tee: ["tshirt"], tshirt: ["tee"], jewelry: ["jewellery"], jewellery: ["jewelry"],
  coord: ["co <-> ord"], coords: ["co <-> ord"], kurti: ["kurta"],
};

/**
 * User text → Postgres tsquery. Every word must match (prefix). Garment words ("tops",
 * "trousers") must match the product's name/category/tags (weights A,B), not its description:
 * "pair it with a crop top" shouldn't put trousers into a search for tops.
 */
export function toTsQuery(q: string): string | null {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return null;
  return words.slice(0, 8).map((w) => {
    const garment = inferCategory({ name: w, productType: null, tags: [] }).category !== "other";
    const term = (t: string) => (t.includes("<->") ? `(${t})` : `${t}:*${garment ? "AB" : ""}`);
    const alts = [w, ...(SYNONYMS[w] ?? [])].map(term);
    return alts.length > 1 ? `(${alts.join(" | ")})` : alts[0];
  }).join(" & ");
}

type Row = {
  id: string; name: string; source_id: string; brand_name: string; category: string; image_url: string | null; url: string;
  price: number | null; price_max: number | null; currency: string | null; original_price: number | null; available: boolean | null;
  released_at: Date | null; released_basis: ProductDTO["releasedBasis"]; first_seen_at: Date; removed_at: Date | null;
  owner_user_id: string | null; is_demo: boolean; saved: boolean;
};

function toDTO(r: Row, newCutoff: number): ProductDTO {
  const releasedAt = iso(r.released_at);
  return {
    id: r.id, name: r.name, brandId: r.source_id, brandName: r.brand_name, category: r.category,
    imageUrl: r.image_url, url: r.url, price: r.price, priceMax: r.price_max, currency: r.currency,
    originalPrice: r.original_price, available: r.available,
    releasedAt, releasedBasis: r.released_basis, firstSeenAt: iso(r.first_seen_at)!,
    isNew: !!releasedAt && Date.parse(releasedAt) >= newCutoff,
    saved: !!r.saved, removed: !!r.removed_at, manual: !!r.owner_user_id, demo: r.is_demo,
  };
}

/** Collects SQL fragments with numbered parameters. */
class Params {
  values: unknown[] = [];
  add(v: unknown) { this.values.push(v); return `$${this.values.length}`; }
}

const SELECT = `p.id, p.name, p.source_id, b.name brand_name, p.category, p.image_url, p.url, p.price, p.price_max, p.currency,
  p.original_price, p.available, p.released_at, p.released_basis, p.first_seen_at, p.removed_at, p.owner_user_id, p.is_demo`;

function scopeSql(viewer: Viewer) {
  // Signed in: only brands this user follows (RLS limits user_subscriptions to their own rows).
  // Signed out: the public preview set (also enforced by RLS on products/sources).
  return viewer ? "p.source_id in (select source_id from user_subscriptions)" : "b.public_preview";
}

function buildWhere(q: CatalogQuery, viewer: Viewer, P: Params, tsq: string | null, skip: "category" | "brand" | null) {
  const w: string[] = [scopeSql(viewer)];
  if (!demoOn()) w.push("not p.is_demo");
  if (tsq) w.push(`p.search @@ to_tsquery('english', ${P.add(tsq)})`);
  if (!q.savedOnly) w.push("p.removed_at is null");      // removed products stay visible in Saved only
  if (skip !== "category" && q.categories?.length) w.push(`p.category = any(${P.add(q.categories)}::text[])`);
  if (skip !== "brand" && q.brands?.length) w.push(`p.source_id = any(${P.add(q.brands)}::text[])`);
  if (q.minPrice != null) w.push(`p.price >= ${P.add(q.minPrice)}`);
  if (q.maxPrice != null) w.push(`p.price <= ${P.add(q.maxPrice)}`);
  if (q.inStock) w.push("p.available");
  if (q.onSale) w.push("p.original_price is not null");
  if (q.savedOnly) w.push(viewer ? "s.id is not null" : "false");
  if (q.drop) w.push(`p.released_at >= ${P.add(dropCutoff(q.drop).toISOString())}`);
  else if (q.newOnly) w.push(`p.released_at >= ${P.add(new Date(Date.now() - newDropDays() * 86400_000).toISOString())}`);
  return `where ${w.join(" and ")}`;
}

const ORDER: Record<SortKey, string> = {
  newest: "p.released_at desc nulls last, p.first_seen_at desc, p.name",
  relevance: "rank desc, p.released_at desc nulls last",
  price_asc: "p.price asc nulls last, p.name",
  price_desc: "p.price desc nulls last, p.name",
  brand: "b.name, p.released_at desc nulls last",
};

function fromSql(viewer: Viewer) {
  return `from products p join sources b on b.id = p.source_id
    ${viewer ? "left join saved_items s on s.product_id = p.id" : "left join (select null::uuid id, null::text product_id) s on false"}`;
}

export async function searchCatalogAs(q: Queryable, viewer: Viewer, query: CatalogQuery): Promise<CatalogResult & { preview: boolean }> {
  const limit = Math.min(Math.max(query.limit ?? 48, 1), MAX_LIMIT);
  let page = Math.max(query.page ?? 1, 1);
  if (!viewer) page = Math.min(page, PREVIEW_PAGES);
  const tsq = query.q ? toTsQuery(query.q) : null;
  const sort: SortKey = query.sort ?? (tsq ? "relevance" : "newest");
  const effectiveSort: SortKey = sort === "relevance" && !tsq ? "newest" : sort;

  // Soft brand mixing for the browse feed (newest / best match). Explicit sorts (price, brand),
  // Saved and New drops keep their exact order.
  const mix = (effectiveSort === "newest" || effectiveSort === "relevance") && !query.savedOnly && !query.drop;

  const PC = new Params(), PB = new Params();
  const facetQueries = [
    // Facets: each dimension counted with every *other* filter applied.
    q.query<{ category: string; n: number }>(
      `select p.category, count(*)::int n ${fromSql(viewer)} ${buildWhere(query, viewer, PC, tsq, "category")} group by p.category`, PC.values),
    q.query<{ id: string; name: string; n: number }>(
      `select b.id, b.name, count(*)::int n ${fromSql(viewer)} ${buildWhere(query, viewer, PB, tsq, "brand")} group by b.id, b.name order by b.name`, PB.values),
    q.query<{ min: number | null; max: number | null }>(
      `select min(p.price) min, max(p.price) max from products p join sources b on b.id = p.source_id
        where ${scopeSql(viewer)} and p.removed_at is null and p.price is not null ${demoOn() ? "" : "and not p.is_demo"}`),
  ] as const;

  let rows: (Row & { total?: number })[];
  let total: number;
  let catRows: { category: string; n: number }[], brandCounts: { id: string; name: string; n: number }[], priceRows: { min: number | null; max: number | null }[];
  if (mix) {
    // 1) The whole ranked result as ids only (cheap), 2) mix it, 3) fetch just this page by id.
    // Mixing the full list (not just one page) keeps pagination a stable slice: no repeats, no jumps.
    const R = new Params();
    const whereR = buildWhere(query, viewer, R, tsq, null);
    const rankR = tsq ? `ts_rank(p.search, to_tsquery('english', ${R.add(tsq)}))` : "0";
    const [ranked, c, b, pr] = await Promise.all([
      q.query<{ id: string; source_id: string }>(
        `select p.id, p.source_id, ${rankR} rank ${fromSql(viewer)} ${whereR} order by ${ORDER[effectiveSort]}, p.id limit ${MIX_CAP}`, R.values),
      ...facetQueries,
    ]);
    [catRows, brandCounts, priceRows] = [c, b, pr];
    const order = diversify(ranked.map((r) => ({ id: r.id, brand: r.source_id })), { weight: effectiveSort === "relevance" ? 0.75 : 0.5 });
    total = order.length;
    const pageIds = order.slice((page - 1) * limit, page * limit).map((o) => o.id);
    const fetched = pageIds.length
      ? await q.query<Row>(`select ${SELECT}, (s.id is not null) saved ${fromSql(viewer)} where p.id = any($1::text[]) and ${scopeSql(viewer)}`, [pageIds])
      : [];
    const pos = new Map(pageIds.map((id, i) => [id, i]));
    rows = fetched.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  } else {
    const P = new Params();
    const where = buildWhere(query, viewer, P, tsq, null);
    const rank = tsq ? `ts_rank(p.search, to_tsquery('english', ${P.add(tsq)}))` : "0";
    const lim = P.add(limit), off = P.add((page - 1) * limit);
    // Independent queries are sent together: one transaction, no waiting between them.
    const [r, c, b, pr] = await Promise.all([
      q.query<Row & { total: number }>(
        `select ${SELECT}, (s.id is not null) saved, ${rank} rank, count(*) over()::int total
           ${fromSql(viewer)} ${where} order by ${ORDER[effectiveSort]} limit ${lim} offset ${off}`, P.values),
      ...facetQueries,
    ]);
    [rows, catRows, brandCounts, priceRows] = [r, c, b, pr];
    total = r[0]?.total ?? 0;
    if (!r.length && page > 1) {
      const C = new Params();
      total = (await q.query<{ n: number }>(`select count(*)::int n ${fromSql(viewer)} ${buildWhere(query, viewer, C, tsq, null)}`, C.values))[0].n;
    }
  }
  const catCounts = new Map(catRows.map((r) => [r.category, r.n]));
  const price = priceRows[0];

  const newCutoff = Date.now() - newDropDays() * 86400_000;
  const maxPage = viewer ? Infinity : PREVIEW_PAGES;
  return {
    items: rows.map((r) => toDTO(r, newCutoff)),
    total, page, pageSize: limit, hasMore: page * limit < total && page < maxPage, sort: effectiveSort,
    preview: !viewer,
    facets: {
      categories: CATEGORIES.filter((c) => catCounts.has(c.id) || query.categories?.includes(c.id))
        .map((c) => ({ id: c.id, label: c.label, count: catCounts.get(c.id) ?? 0 })),
      brands: brandCounts.map((b) => ({ id: b.id, label: b.name, count: b.n })),
      price: price ?? { min: null, max: null },
    },
  };
}

export const searchCatalog = (viewer: Viewer, query: CatalogQuery) => withViewer(viewer, (q) => searchCatalogAs(q, viewer, query));

/** Brands for the "From [brand]" picker: the viewer's own brands (or the preview set). */
export const brandOptions = (viewer: Viewer) => withViewer(viewer, (q) => brandOptionsAs(q, viewer));
export function brandOptionsAs(q: Queryable, viewer: Viewer) {
  return q.query<{ id: string; label: string; count: number }>(
    `select b.id, b.name label, count(p.id)::int count from sources b
       left join products p on p.source_id = b.id and p.removed_at is null ${demoOn() ? "" : "and not p.is_demo"}
      where ${viewer ? "b.id in (select source_id from user_subscriptions)" : "b.public_preview"}
      group by b.id, b.name order by b.name`);
}

export const categoryOptions = (viewer: Viewer) => withViewer(viewer, (q) => categoryOptionsAs(q, viewer));
export async function categoryOptionsAs(q: Queryable, viewer: Viewer) {
  const rows = await q.query<{ category: string; n: number }>(
    `select p.category, count(*)::int n from products p join sources b on b.id = p.source_id
      where ${scopeSql(viewer)} and p.removed_at is null ${demoOn() ? "" : "and not p.is_demo"} group by p.category`);
  const counts = new Map(rows.map((r) => [r.category, r.n]));
  return CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id)! }));
}

/** Recently published collections (source-reported dates only) from the viewer's brands. */
export const recentCollections = (viewer: Viewer, window: string, limit = 12) =>
  withViewer(viewer, (q) => recentCollectionsAs(q, viewer, window, limit));
export async function recentCollectionsAs(q: Queryable, viewer: Viewer, window: string, limit = 12): Promise<CollectionDTO[]> {
  const rows = await q.query<{ id: string; title: string; url: string; image_url: string | null;
      products_count: number | null; published_at: Date; source_id: string; brand_name: string }>(
    `select c.*, b.name brand_name from collections c join sources b on b.id = c.source_id
      where ${viewer ? "b.id in (select source_id from user_subscriptions)" : "b.public_preview"}
        and c.published_at is not null and c.published_at >= $1 and (c.products_count is null or c.products_count > 0)
        and c.handle not in ('all','frontpage','home','shop-all','new-arrivals','new-in','bestsellers','best-sellers','sale')
      order by c.published_at desc limit $2`, [dropCutoff(window).toISOString(), limit]);
  return rows.map((r) => ({ id: r.id, title: r.title, url: r.url, imageUrl: r.image_url, productsCount: r.products_count,
    publishedAt: iso(r.published_at)!, brandId: r.source_id, brandName: r.brand_name }));
}

/** A handful of recent real product images from different brands, for the hero collage. */
export const heroProducts = (viewer: Viewer, n = 6) => withViewer(viewer, (q) => heroProductsAs(q, viewer, n));
export async function heroProductsAs(q: Queryable, viewer: Viewer, n = 6): Promise<ProductDTO[]> {
  const sql = (scope: string) => `select ${SELECT}, false saved from products p join sources b on b.id = p.source_id
      where ${scope} and p.removed_at is null and not p.is_demo and p.image_url is not null and p.owner_user_id is null
        and p.category in ('tops','dresses','skirts','coords','bottoms','outerwear')
      order by p.released_at desc nulls last limit 200`;
  let pool = await q.query<Row>(sql(scopeSql(viewer)));
  // A brand-new account with no brands yet still gets a collage, from the public preview set.
  if (!pool.length && viewer) pool = await withViewer(null, (q) => q.query<Row>(sql("b.public_preview")));
  const picked: Row[] = [];
  const brands = new Set<string>();
  for (const r of pool) {
    if (brands.has(r.source_id)) continue;
    brands.add(r.source_id); picked.push(r);
    if (picked.length === n) break;
  }
  return picked.map((r) => toDTO(r, 0));
}

export const heroStats = (viewer: Viewer) => withViewer(viewer, (q) => heroStatsAs(q, viewer));
export async function heroStatsAs(q: Queryable, viewer: Viewer) {
  const [r] = await q.query<{ products: number; brands: number; week: number }>(
    `select count(*)::int products, count(distinct p.source_id)::int brands,
            count(*) filter (where p.released_at >= now() - interval '7 days')::int week
       from products p join sources b on b.id = p.source_id
      where ${scopeSql(viewer)} and p.removed_at is null and not p.is_demo`);
  const brands = viewer ? (await q.query<{ n: number }>("select count(*)::int n from user_subscriptions"))[0].n : r.brands;
  return { products: r.products, brands, newThisWeek: r.week };
}

/* ---------------- Saved items (always as the user; RLS enforces ownership) ---------------- */

export async function savedIds(viewer: Viewer): Promise<string[]> {
  if (!viewer) return [];
  return (await withViewer(viewer, (q) => q.query<{ product_id: string }>("select product_id from saved_items order by saved_at desc")))
    .map((r) => r.product_id);
}

export async function setSaved(userId: string, productId: string, saved: boolean): Promise<"ok" | "not_found" | "rate_limited"> {
  if (saved && !(await checkRateLimit(userId, "save"))) return "rate_limited";
  return withViewer({ userId }, async (q) => {
    if (saved) {
      // The insert policy only allows products this user can see.
      const visible = await q.query("select 1 from products where id = $1", [productId]);
      if (!visible.length) return "not_found";
      await q.query("insert into saved_items (user_id, product_id) values (auth.uid(), $1) on conflict (user_id, product_id) do nothing", [productId]);
    } else {
      await q.query("delete from saved_items where product_id = $1", [productId]);
    }
    return "ok";
  });
}
