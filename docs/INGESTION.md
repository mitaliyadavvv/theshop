# Ingestion assessment & status

Assessed and imported on **16 Oct 2026**. Baaori was removed from the registry at the user's request.

## Summary

| Source | Platform | Method | Prices | Images | Links | Dates | Auto-update | Status | Products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Basata | Shopify | `/products.json` | ✓ INR | ✓ | ✓ | publish ✓ | ✓ | Connected | 230 |
| Be You Studio | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 17 |
| Bisou by Sachi | Shopify | `/collections/womens/products.json`, falling back to `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected — see note | 76 |
| Butter | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 42 |
| JimBhi | Shopify | `/collections/tops/products.json`, falling back to `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected — see note | 51 |
| Just Pals | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 16 |
| Korakagaz India | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 97 |
| Noises India | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 37 |
| Rerunn | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 125 |
| Sundazed | Shopify | `/products.json` + `/collections.json` | ✓ | ✓ | ✓ | ✓ (+ collection dates) | ✓ | Connected | 42 |
| Wear Chapters | Shopify | `/products.json` | ✓ | ✓ | ✓ | ✓ | ✓ | Connected | 79 |
| The ROK | WordPress + WooCommerce | Store API `/wp-json/wc/store/v1/products` | ✓ INR | ✓ | ✓ | **none exposed** | ✓ | Connected | 511 |
| SRVDCOLD | Instagram | manual | – | – | – | – | ✗ | Manual source | 0 |

That's 12 of 13 sources automated and 1,323 products total. Two adapters cover the 12 automated sources: one Shopify adapter for 11 stores and one WooCommerce adapter for The ROK.

## Process

1. Probed every URL for a Shopify `products.json` feed, then checked robots.txt. No store disallows `/products.json` or the Woo Store API.
2. Identified The ROK as WooCommerce from its HTML markers, then verified its public Store API (511 products, 6 pages).
3. Tested end to end on 5 representative sources: Just Pals (small), Sundazed (collections), Baaori (paginated, 370 products), JimBhi (collection scope), and The ROK (WooCommerce). Then scaled to the rest.

## Notes and limitations

- **Rate limiting.** Shopify throttles automated clients per IP across stores. It is much stricter on collection endpoints (`/collections.json`, `/collections/*/products.json`, collection HTML pages) than on `/products.json`. Node's HTTP client got 429 where curl did not, which suggests client-fingerprint throttling. The app does **not** disguise itself or work around this. Instead it:
  - identifies itself honestly (`Mozilla/5.0 (compatible; TheShopDiscovery/0.1; …)`, the standard crawler format)
  - spaces requests at 1.5 s globally and 1.2 s per host
  - honours `Retry-After`
  - gives optional endpoints a single attempt
  - retries failed sources hourly
- **Bisou by Sachi / JimBhi collection scope.** You supplied collection URLs (`/collections/womens`, `/collections/tops`), and that preference is stored. Right now the collection feeds return 429 to this client, so the adapter imported each **full store** and says so on the Brands page. Every sync tries collection-only first. You can switch to the whole store permanently under Brands → Details → *Include the whole store*.
- **Collections ("new collections" on New drops).** These come from `/collections.json`, which is often throttled. When that happens it's skipped and retried next sync, and products are unaffected. Only Sundazed's collections were captured in this run.
- **The ROK.** The Store API has no publish or creation dates. Products from the first import have no release date and never appear as new drops. Products that show up in later syncs are dated "First seen".
- **SRVDCOLD.** Instagram is not scraped, because of its terms and because no permitted public product feed exists. Use Brands → SRVDCOLD → *Add products* to paste product links by hand. `srvdcold.com` exists, but it returns HTTP 402 ("store unavailable") and isn't verified as the same brand, so it was not added. If they reopen a store, add it as a new brand.
- **Categories.** Most stores leave `product_type` empty, so categories are inferred from the product type, then the name, then a tag vote. Nothing is assumed: 36 products with no recognisable garment word stay in **Other** (sarees and drapes, for example). The original source category is kept as `source_category`.
- **Logos** come from each site's `apple-touch-icon` or `favicon` link, where present.
- **Sale flags.** These reflect the brand's own compare-at price. Noises India marks all 37 products this way.

## What remains / ideas

- Collection-only scope for Bisou and JimBhi depends on Shopify easing its throttling on collection endpoints.
- Collection-level drops for more brands, for the same reason.
- An Instagram Graph API adapter, if you manage or get access to the account.
- A JSON-LD / sitemap adapter for future brands on platforms other than Shopify or WooCommerce. These are currently saved as *Needs setup*, with manual product entry available.
- Multi-user saved items: the schema already keys `saved_items` by `user_id`.
