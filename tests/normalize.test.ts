import { test } from "node:test";
import assert from "node:assert/strict";
import { inferCategory, isExcludedProduct, releaseDate, stripHtml } from "../src/server/ingest/normalize";
import { parseSourceUrl } from "../src/server/url";
import { toTsQuery } from "../src/server/catalog";
import { normalizeShopifyProduct } from "../src/server/ingest/adapters/shopify";
import { normalizeWooProduct } from "../src/server/ingest/adapters/woocommerce";

const cat = (name: string, productType: string | null = null, tags: string[] = []) => inferCategory({ name, productType, tags }).category;

test("categories come from real product info, most specific first", () => {
  assert.equal(cat("Mehfil Set"), "coords");
  assert.equal(cat("Set of 3 Scrunchies"), "accessories");
  assert.equal(cat("Linen Shirt Dress"), "dresses");
  assert.equal(cat("Mishri - White High Rise Barrel Pants"), "bottoms");
  assert.equal(cat("Silver Hoop Earrings"), "jewellery");
  assert.equal(cat("Moss Grid Blazer"), "outerwear");
  assert.equal(cat("Bridey Rhinestone Tank Top"), "tops");
  assert.equal(cat("Mini Skirt"), "skirts");
  assert.equal(cat("Denim Effect Cotton Top"), "tops");
  assert.equal(cat("Nairaa Top And Salwar"), "coords");
  assert.equal(cat("Something", null, ["cordset"]), "coords");
  assert.equal(cat("Something", "Top"), "tops");                    // product_type wins
  assert.equal(cat("Viola", null, ["Dresses", "Dresses", "Sale"]), "dresses"); // tag vote
  assert.equal(cat("Mystery item"), "other");                       // never guessed
});

test("non-product listings are excluded", () => {
  assert.ok(isExcludedProduct("Gift Card", null));
  assert.ok(!isExcludedProduct("Tip-toe Sandals", null));
});

test("release date never treats an import or a re-publish as a launch", () => {
  const seen = "2026-10-16T00:00:00.000Z";
  // Re-published old item: created long before published → use created date.
  assert.deepEqual(releaseDate({ sourcePublishedAt: "2026-10-10T00:00:00.000Z", sourceCreatedAt: "2025-01-01T00:00:00.000Z" }, seen, true),
    { releasedAt: "2025-01-01T00:00:00.000Z", basis: "created" });
  assert.equal(releaseDate({ sourcePublishedAt: "2026-10-10T00:00:00.000Z", sourceCreatedAt: "2026-10-09T00:00:00.000Z" }, seen, true).basis, "published");
  // No source dates, first import (baseline) → no release date at all.
  assert.deepEqual(releaseDate({ sourcePublishedAt: null, sourceCreatedAt: null }, seen, false), { releasedAt: null, basis: null });
  // No source dates, discovered after baseline → first-seen.
  assert.deepEqual(releaseDate({ sourcePublishedAt: null, sourceCreatedAt: null }, seen, true), { releasedAt: seen, basis: "first_seen" });
});

test("source URLs are validated and canonicalised", () => {
  const p = parseSourceUrl("https://www.Basata.co.in/?utm_source=ig&fbclid=x");
  assert.ok(p.ok && p.canonical === "https://www.basata.co.in/" && p.host === "basata.co.in");
  const c = parseSourceUrl("jimbhi.in/collections/tops");
  assert.ok(c.ok && c.collectionHandle === "tops");
  const ig = parseSourceUrl("https://www.instagram.com/srvdcold/");
  assert.ok(ig.ok && ig.social === "instagram");
  assert.equal(parseSourceUrl("not a url").ok, false);
  assert.equal(parseSourceUrl("http://localhost:3000").ok, false);
});

test("search query: every word must match, with prefix + synonyms; garment words limited to name/category/tags", () => {
  assert.equal(toTsQuery("silver tops"), "silver:* & tops:*AB");
  assert.equal(toTsQuery("linen pants"), "linen:* & (pants:*AB | trousers:*AB)");
  assert.equal(toTsQuery("o'brien) | !x"), "o:* & brien:* & x:*");   // operators can't be injected
  assert.equal(toTsQuery("   "), null);
});

test("Shopify normaliser: min price, verified sale, availability, no invented currency", () => {
  const p = normalizeShopifyProduct({
    id: 1, title: " Top ", handle: "top", body_html: "<p>Soft&nbsp;cotton</p>", published_at: "2026-10-01T10:00:00+05:30", created_at: "2026-10-01T09:00:00+05:30",
    vendor: "X", product_type: "", tags: ["Tops"],
    variants: [{ price: "1999.00", compare_at_price: "2499.00", available: false }, { price: "2199.00", compare_at_price: null, available: true }],
    images: [{ src: "https://cdn.shopify.com/a.jpg" }],
  }, "https://shop.test", null);
  assert.equal(p.price, 1999); assert.equal(p.priceMax, 2199); assert.equal(p.originalPrice, 2499);
  assert.equal(p.available, true); assert.equal(p.currency, null); assert.equal(p.description, "Soft cotton");
  assert.equal(p.url, "https://shop.test/products/top"); assert.equal(p.name, "Top");
});

test("Woo normaliser: minor units, no dates", () => {
  const p = normalizeWooProduct({
    id: 9, name: "Moss Grid Blazer", slug: "moss", permalink: "https://therok.co/product/moss/", type: "simple",
    short_description: "", description: "<p>Cotton</p>", on_sale: false,
    prices: { price: "399900", regular_price: "399900", sale_price: "399900", currency_code: "INR", currency_minor_unit: 2, price_range: null },
    images: [], categories: [{ name: "Blazer" }], tags: [], is_in_stock: true, is_purchasable: true,
  });
  assert.equal(p.price, 3999); assert.equal(p.originalPrice, null); assert.equal(p.currency, "INR");
  assert.equal(p.sourcePublishedAt, null); assert.equal(p.imageUrl, null);
});

test("stripHtml", () => assert.equal(stripHtml("<p>a</p><p>b &amp; c</p>"), "a\nb & c"));
