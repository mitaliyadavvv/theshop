import { getJson, isTransient } from "../http";
import { stripHtml, toIso, toNumber } from "../normalize";
import type { FetchResult, IngestionAdapter, NormalizedCollection, NormalizedProduct, SourceContext } from "../types";
import { SourceError } from "../types";

type ShopifyVariant = { price: string; compare_at_price: string | null; available?: boolean };
type ShopifyImage = { src: string };
type ShopifyProduct = {
  id: number; title: string; handle: string; body_html: string | null;
  published_at: string | null; created_at: string | null;
  vendor: string | null; product_type: string | null; tags: string[] | string;
  variants: ShopifyVariant[]; images: ShopifyImage[];
};
type ShopifyCollection = {
  id: number; title: string; handle: string; published_at: string | null;
  products_count?: number; image?: { src: string } | null;
};

const PAGE_SIZE = 250;
const MAX_PAGES = 40; // 10k products — a safety valve, not an expected size

function feedBase(ctx: Pick<SourceContext, "origin" | "scope" | "collectionHandle">) {
  return ctx.scope === "collection" && ctx.collectionHandle
    ? `${ctx.origin}/collections/${encodeURIComponent(ctx.collectionHandle)}/products.json`
    : `${ctx.origin}/products.json`;
}

/** products.json has no currency; the public /meta.json store record does. */
async function storeCurrency(origin: string): Promise<{ currency: string | null; requests: number }> {
  try {
    const { data } = await getJson<{ currency?: string }>(`${origin}/meta.json`, { retries: 2 });
    return { currency: data.currency ?? null, requests: 1 };
  } catch (e) {
    if (isTransient(e)) throw e;   // don't overwrite good prices with currency-less ones
    return { currency: null, requests: 1 };
  }
}

export function normalizeShopifyProduct(p: ShopifyProduct, origin: string, currency: string | null): NormalizedProduct {
  const prices = p.variants.map((v) => toNumber(v.price)).filter((n): n is number => n != null);
  const price = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  // Sale price only when the cheapest variant carries a higher compare-at price.
  const cheapest = p.variants.find((v) => toNumber(v.price) === price);
  const compare = cheapest ? toNumber(cheapest.compare_at_price) : null;
  const tags = (Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(",")).map((t) => t.trim()).filter(Boolean);
  const avail = p.variants.some((v) => typeof v.available === "boolean")
    ? p.variants.some((v) => v.available === true)
    : null;
  const images = p.images.map((i) => i.src).filter(Boolean);
  return {
    externalId: String(p.id),
    handle: p.handle,
    name: p.title.trim(),
    description: stripHtml(p.body_html),
    sourceCategory: p.product_type?.trim() || null,
    tags,
    vendor: p.vendor,
    imageUrl: images[0] ?? null,
    imageUrls: images.slice(0, 8),
    url: `${origin}/products/${p.handle}`,
    price,
    priceMax,
    currency,
    originalPrice: compare != null && price != null && compare > price ? compare : null,
    available: avail,
    sourcePublishedAt: toIso(p.published_at),
    sourceCreatedAt: toIso(p.created_at),
    raw: { id: p.id, handle: p.handle, product_type: p.product_type, published_at: p.published_at, created_at: p.created_at },
  };
}

export const shopifyAdapter: IngestionAdapter = {
  method: "shopify_products_json",
  platform: "shopify",

  async detect(origin, collectionHandle) {
    try {
      // Probe the store-wide feed: collection endpoints are throttled more aggressively,
      // and a store that serves /products.json is Shopify either way.
      const { data } = await getJson<{ products?: unknown[] }>(`${origin}/products.json?limit=1`, { retries: 2 });
      if (!Array.isArray(data.products)) return null;
      return { platform: "shopify", method: this.method, sample: data.products.length,
        detail: collectionHandle ? `Collection preference: ${collectionHandle}` : undefined };
    } catch (e) {
      if (isTransient(e)) throw e;   // rate limit / outage: not evidence the platform is absent
      return null;
    }
  },

  async fetchCatalogue(ctx): Promise<FetchResult> {
    const warnings: string[] = [];
    const { currency, requests: curReq } = await storeCurrency(ctx.origin);
    let requests = curReq;
    if (!currency) warnings.push("Store currency not exposed; prices shown without assuming a currency.");

    let base = feedBase(ctx);
    const products: NormalizedProduct[] = [];
    let complete = false;
    let usedScope: "store" | "collection" = ctx.scope === "collection" && ctx.collectionHandle ? "collection" : "store";
    for (let page = 1; page <= MAX_PAGES; page++) {
      let batch: ShopifyProduct[];
      try {
        // A collection feed gets one quick attempt; if throttled, fall back to the store feed
        // (the user's collection preference is kept and retried next sync).
        const firstCollectionPage = page === 1 && usedScope === "collection";
        let data: { products: ShopifyProduct[] };
        try {
          ({ data } = await getJson<{ products: ShopifyProduct[] }>(`${base}?limit=${PAGE_SIZE}&page=${page}`, firstCollectionPage ? { retries: 0 } : {}));
        } catch (e) {
          if (!firstCollectionPage || !isTransient(e)) throw e;
          requests++;
          warnings.unshift(`The “${ctx.collectionHandle}” collection feed is throttled for automated readers (${(e as Error).message}), so the full store catalogue was imported instead. Collection-only will be tried again next sync.`);
          usedScope = "store";
          base = feedBase({ ...ctx, scope: "store" });
          ({ data } = await getJson<{ products: ShopifyProduct[] }>(`${base}?limit=${PAGE_SIZE}&page=${page}`));
        }
        requests++;
        batch = data.products ?? [];
      } catch (e) {
        requests++;
        if (page === 1) throw e;
        warnings.push(`Stopped at page ${page}: ${(e as Error).message}. Earlier pages were imported.`);
        break;
      }
      for (const p of batch) {
        try {
          products.push(normalizeShopifyProduct(p, ctx.origin, currency));
        } catch (e) {
          warnings.push(`Skipped product ${p?.id}: ${(e as Error).message}`);
        }
      }
      if (batch.length < PAGE_SIZE) { complete = true; break; }
    }
    if (!complete && !warnings.some((w) => w.startsWith("Stopped"))) warnings.push(`Reached page limit (${MAX_PAGES}).`);
    if (products.length === 0 && complete) {
      throw new SourceError("Feed is reachable but lists no products.", "parse");
    }

    // Collections: release-level info (title + publish date). Optional — never fails the sync.
    const collections: NormalizedCollection[] = [];
    try {
      // Shopify rate-limits this endpoint harder than products.json: one attempt, no retries.
      const { data } = await getJson<{ collections: ShopifyCollection[] }>(`${ctx.origin}/collections.json?limit=250`, { retries: 0 });
      requests++;
      for (const c of data.collections ?? []) {
        collections.push({
          externalId: String(c.id), title: c.title.trim(), handle: c.handle,
          url: `${ctx.origin}/collections/${c.handle}`,
          imageUrl: c.image?.src ?? null,
          productsCount: typeof c.products_count === "number" ? c.products_count : null,
          publishedAt: toIso(c.published_at),
        });
      }
    } catch (e) {
      requests++;
      warnings.push(`Collections skipped this time (${(e as Error).message}); will try again next sync.`);
    }
    return { products, collections, complete, warnings, requests };
  },
};
