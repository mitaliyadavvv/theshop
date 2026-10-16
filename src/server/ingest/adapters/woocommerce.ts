import { getJson, isTransient } from "../http";
import { decodeEntities, stripHtml, toNumber } from "../normalize";
import type { FetchResult, IngestionAdapter, NormalizedProduct } from "../types";

/** WooCommerce Store API (public, unauthenticated, read-only). */
type WooPrices = {
  price: string; regular_price: string; sale_price: string; currency_code: string; currency_minor_unit: number;
  price_range: { min_amount: string; max_amount: string } | null;
};
type WooProduct = {
  id: number; name: string; slug: string; permalink: string; type: string;
  short_description: string; description: string; on_sale: boolean;
  prices: WooPrices; images: { src: string; thumbnail?: string; srcset?: string }[];
  categories: { name: string }[]; tags: { name: string }[];
  is_in_stock: boolean; is_purchasable: boolean;
};

const PER_PAGE = 100;
const MAX_PAGES = 50;

const minor = (v: string | undefined, unit: number) => {
  const n = toNumber(v);
  return n == null ? null : n / 10 ** unit;
};

/**
 * Grid-sized image: the smallest WordPress-generated variant at least `min` px wide (from
 * the Store API's srcset). The full-size `src` is often a 2,560 px, ~600 KB original.
 */
export function gridImage(img: { src: string; srcset?: string }, min = 600): string {
  const candidates = (img.srcset ?? "").split(",").map((c) => c.trim().split(/\s+/))
    .map(([url, w]) => ({ url, w: Number(w?.replace(/w$/, "")) }))
    .filter((c) => c.url && Number.isFinite(c.w) && c.w >= min)
    .sort((a, b) => a.w - b.w);
  return candidates[0]?.url ?? img.src;
}

export function normalizeWooProduct(p: WooProduct): NormalizedProduct {
  const unit = p.prices?.currency_minor_unit ?? 2;
  const price = p.prices?.price_range ? minor(p.prices.price_range.min_amount, unit) : minor(p.prices?.price, unit);
  const priceMax = p.prices?.price_range ? minor(p.prices.price_range.max_amount, unit) : price;
  const regular = minor(p.prices?.regular_price, unit);
  const images = (p.images ?? []).map((i) => i.src).filter(Boolean);
  return {
    externalId: String(p.id),
    handle: p.slug,
    name: decodeEntities(p.name),
    description: stripHtml(p.short_description || p.description),
    sourceCategory: p.categories?.map((c) => decodeEntities(c.name)).join(", ") || null,
    tags: [...(p.categories ?? []), ...(p.tags ?? [])].map((t) => decodeEntities(t.name)),
    vendor: null,
    imageUrl: p.images?.[0] ? gridImage(p.images[0]) : null,   // full-size originals stay in imageUrls
    imageUrls: images.slice(0, 8),
    url: p.permalink,
    price,
    priceMax,
    currency: p.prices?.currency_code || null,
    originalPrice: p.on_sale && regular != null && price != null && regular > price ? regular : null,
    available: typeof p.is_in_stock === "boolean" ? p.is_in_stock : null,
    // The Store API exposes no publish/creation dates. Recency falls back to first-seen.
    sourcePublishedAt: null,
    sourceCreatedAt: null,
    raw: { id: p.id, slug: p.slug, type: p.type },
  };
}

export const wooAdapter: IngestionAdapter = {
  method: "woocommerce_store_api",
  platform: "woocommerce",

  async detect(origin) {
    try {
      const { data } = await getJson<unknown>(`${origin}/wp-json/wc/store/v1/products?per_page=1`, { retries: 2 });
      if (!Array.isArray(data)) return null;
      return { platform: "woocommerce", method: this.method, sample: data.length,
        detail: "WooCommerce Store API exposes no publish dates; recency uses first-seen dates." };
    } catch (e) {
      if (isTransient(e)) throw e;   // rate limit / outage: not evidence the platform is absent
      return null;
    }
  },

  async fetchCatalogue(ctx): Promise<FetchResult> {
    const warnings = ["Source exposes no publish dates — products found after the first import are dated by first-seen."];
    const products: NormalizedProduct[] = [];
    let requests = 0;
    let complete = false;
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      try {
        const { data, headers } = await getJson<WooProduct[]>(
          `${ctx.origin}/wp-json/wc/store/v1/products?per_page=${PER_PAGE}&page=${page}&orderby=date&order=desc`,
        );
        requests++;
        totalPages = Number(headers.get("x-wp-totalpages")) || (data.length === PER_PAGE ? page + 1 : page);
        for (const p of data) {
          try { products.push(normalizeWooProduct(p)); }
          catch (e) { warnings.push(`Skipped product ${p?.id}: ${(e as Error).message}`); }
        }
        if (page >= totalPages) complete = true;
      } catch (e) {
        requests++;
        if (page === 1) throw e;
        warnings.push(`Stopped at page ${page}: ${(e as Error).message}. Earlier pages were imported.`);
        break;
      }
    }
    return { products, collections: [], complete, warnings, requests };
  },
};
