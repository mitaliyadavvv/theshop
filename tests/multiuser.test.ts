/**
 * Multi-user isolation, enforced by the database (RLS + grants) and the server layer.
 * Runs our real Supabase migration on PGlite (in-process Postgres).
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createUser, setupTestDb } from "./support/pglite";
import { followSource, unfollow, addManualProduct, findOrCreateSource } from "../src/server/registry";
import { searchCatalog, setSaved, savedIds } from "../src/server/catalog";
import { myBrands } from "../src/server/sources-dto";
import { upsertProducts } from "../src/server/ingest/pipeline";
import { checkRateLimit } from "../src/server/rate-limit";
import { parseSourceUrl } from "../src/server/url";
import { assertPublicUrl } from "../src/server/ingest/http";
import type { NormalizedProduct } from "../src/server/ingest/types";
import type { SourceRow } from "../src/server/registry";

let pg: PGlite;
let A: string, B: string;

const product = (id: string, name: string, extra: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  externalId: id, handle: id, name, description: null, sourceCategory: null, tags: [], vendor: null,
  imageUrl: `https://cdn.example/${id}.jpg`, imageUrls: [], url: `https://example.test/products/${id}`,
  price: 1999, priceMax: 1999, currency: "INR", originalPrice: null, available: true,
  sourcePublishedAt: "2026-10-01T00:00:00.000Z", sourceCreatedAt: "2026-10-01T00:00:00.000Z", ...extra,
});

/** A source that has already been imported (so following it reuses data, no network). */
async function importedSource(url: string, items: NormalizedProduct[], preview = false) {
  const p = parseSourceUrl(url);
  if (!p.ok) throw new Error(p.error);
  const { source } = await findOrCreateSource(p);
  await pg.query("update sources set ingestion_method = 'shopify_products_json', platform = 'shopify', status = 'ok', last_successful_sync = now(), public_preview = $2 where id = $1", [source.id, preview]);
  const s = (await pg.query<SourceRow>("select * from sources where id = $1", [source.id])).rows[0];
  await upsertProducts(s, items.map((i) => ({ ...i, url: i.url.replace("example.test", p.host) })), true);
  return s;
}

const err = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return (e as Error).message; } };

before(async () => {
  ({ pg } = await setupTestDb());
  A = await createUser(pg, "a@example.com");
  B = await createUser(pg, "b@example.com");
  await importedSource("https://brand-x.test/", [product("x1", "Linen Shirt"), product("x2", "Silver Hoop Earrings")]);
  await importedSource("https://brand-y.test/", [product("y1", "Wide Leg Trousers"), product("y2", "Slip Dress")]);
  await importedSource("https://preview.test/", [product("p1", "Preview Top")], true);
});

describe("accounts start empty and stay independent", () => {
  test("profiles are created for new accounts", async () => {
    const r = await pg.query("select id from profiles where id in ($1, $2)", [A, B]);
    assert.equal(r.rows.length, 2);
  });

  test("1–2. User A adds Brand X and sees it", async () => {
    const r = await followSource(A, { url: "https://www.brand-x.test/?utm_source=ig" });
    assert.ok(r.ok, !r.ok ? r.error : "");
    assert.equal(r.ok && r.needsSync, false, "already-imported source is reused, no new ingestion job");
    assert.deepEqual((await myBrands(A)).map((b) => b.name), ["Brand-x"]);
    const cat = await searchCatalog({ userId: A }, {});
    assert.deepEqual(cat.items.map((i) => i.name).sort(), ["Linen Shirt", "Silver Hoop Earrings"]);
  });

  test("3–4. User B does not see Brand X", async () => {
    assert.deepEqual(await myBrands(B), []);
    assert.equal((await searchCatalog({ userId: B }, {})).total, 0);
  });

  test("5. User B adds Brand Y and sees only its products", async () => {
    const r = await followSource(B, { url: "brand-y.test" });
    assert.ok(r.ok);
    const cat = await searchCatalog({ userId: B }, {});
    assert.deepEqual(cat.items.map((i) => i.brandId), ["brand-y", "brand-y"]);
    assert.equal((await searchCatalog({ userId: A }, {})).items.some((i) => i.brandId === "brand-y"), false);
  });

  test("adding the same brand twice is rejected, without duplicates", async () => {
    const r = await followSource(A, { url: "https://brand-x.test" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
    const n = await pg.query<{ n: number }>("select count(*)::int n from user_subscriptions where user_id = $1", [A]);
    assert.equal(n.rows[0].n, 1);
  });
});

describe("6. B cannot read, edit or delete A's subscription — server layer", () => {
  test("unfollow with A's subscription id does nothing", async () => {
    const aSub = (await pg.query<{ id: string }>("select id from user_subscriptions where user_id = $1", [A])).rows[0].id;
    assert.equal(await unfollow(B, aSub), false);
    assert.equal(await unfollow(B, "brand-x"), false);
    assert.equal((await myBrands(A)).length, 1);
  });
});

describe("6. … and at the database layer (RLS), as a hostile client would try", () => {
  test("B cannot select A's subscriptions", async () => {
    const rows = await asUser(pg, B, "select * from user_subscriptions where user_id = $1", [A]);
    assert.equal(rows.length, 0);
  });
  test("B cannot update A's subscription (incl. reassigning it)", async () => {
    const rows = await asUser(pg, B, "update user_subscriptions set preferences = '{\"x\":1}' where user_id = $1 returning id", [A]);
    assert.equal(rows.length, 0);
    const reassign = await err(() => asUser(pg, B, "update user_subscriptions set user_id = $2 where user_id = $1 returning id", [A, B]));
    assert.match(reassign ?? "", /permission denied/, "user_id is not an updatable column");
  });
  test("A cannot move their own subscription to B", async () => {
    const e = await err(() => asUser(pg, A, "update user_subscriptions set user_id = $1 returning id", [B]));
    assert.match(e ?? "", /permission denied/);
  });
  test("B cannot delete A's subscription", async () => {
    const rows = await asUser(pg, B, "delete from user_subscriptions where user_id = $1 returning id", [A]);
    assert.equal(rows.length, 0);
    assert.equal((await pg.query("select 1 from user_subscriptions where user_id = $1", [A])).rows.length, 1);
  });
  test("B cannot create a subscription owned by A", async () => {
    const e = await err(() => asUser(pg, B, "insert into user_subscriptions (user_id, source_id, original_url) values ($1, 'brand-y', 'x')", [A]));
    assert.match(e ?? "", /row-level security/);
  });
});

describe("7. saved products are private", () => {
  test("A saves a product; B cannot see, remove or forge it", async () => {
    assert.equal(await setSaved(A, "brand-x:x1", true), "ok");
    assert.equal(await setSaved(A, "brand-x:x1", true), "ok");     // idempotent
    assert.deepEqual(await savedIds({ userId: A }), ["brand-x:x1"]);
    assert.deepEqual(await savedIds({ userId: B }), []);
    assert.equal((await asUser(pg, B, "select * from saved_items")).length, 0);
    assert.equal((await asUser(pg, B, "delete from saved_items where user_id = $1 returning id", [A])).length, 0);
    await setSaved(B, "brand-x:x1", false);                         // B "unsaving" only touches B's rows
    assert.deepEqual(await savedIds({ userId: A }), ["brand-x:x1"]);
    const forged = await err(() => asUser(pg, B, "insert into saved_items (user_id, product_id) values ($1, 'brand-y:y1')", [A]));
    assert.match(forged ?? "", /row-level security/);
    const dupes = await pg.query<{ n: number }>("select count(*)::int n from saved_items where user_id = $1", [A]);
    assert.equal(dupes.rows[0].n, 1);
  });
  test("saved flag in the catalogue is per-user", async () => {
    const forA = await searchCatalog({ userId: A }, { savedOnly: true });
    assert.deepEqual(forA.items.map((i) => i.id), ["brand-x:x1"]);
    assert.equal(forA.items[0].saved, true);
  });
});

describe("8. shared product data is reused, and unfollowing never deletes it", () => {
  test("B follows Brand X: same source, same products, no new ingestion", async () => {
    const before = (await pg.query<{ n: number }>("select count(*)::int n from sources")).rows[0].n;
    const r = await followSource(B, { url: "https://brand-x.test/" });
    assert.ok(r.ok && !r.needsSync);
    assert.equal((await pg.query<{ n: number }>("select count(*)::int n from sources")).rows[0].n, before);
    const ids = (await searchCatalog({ userId: B }, { brands: ["brand-x"] })).items.map((i) => i.id).sort();
    assert.deepEqual(ids, ["brand-x:x1", "brand-x:x2"]);
  });
  test("B unfollowing Brand X leaves A's subscription and the shared catalogue intact", async () => {
    assert.equal(await unfollow(B, "brand-x"), true);
    assert.equal((await myBrands(A)).length, 1);
    assert.equal((await pg.query("select 1 from products where source_id = 'brand-x'")).rows.length, 2);
    assert.deepEqual(await savedIds({ userId: A }), ["brand-x:x1"]);
  });
});

describe("manual products are private to whoever adds them", () => {
  test("A's manual product is invisible to B", async () => {
    const r = await addManualProduct(A, "brand-x", { url: "https://instagram.com/p/abc", name: "DM-to-order Corset Top" });
    assert.ok("ok" in r);
    await followSource(B, { sourceId: "brand-x" });
    assert.equal((await searchCatalog({ userId: B }, { q: "corset" })).total, 0);
    assert.equal((await searchCatalog({ userId: A }, { q: "corset" })).total, 1);
    assert.equal(await setSaved(B, (r as { id: string }).id, true), "not_found");
    assert.equal((await addManualProduct(B, "brand-y-nope", { url: "https://x.test", name: "x" }) as { error: string }).error, "Follow this brand first.");
    await unfollow(B, "brand-x");
  });
});

describe("11. unauthenticated visitors", () => {
  test("cannot read or modify private data", async () => {
    for (const sql of [
      "select * from user_subscriptions", "select * from saved_items", "select * from profiles",
      "insert into user_subscriptions (user_id, source_id, original_url) values ('" + A + "', 'brand-x', 'x')",
      "insert into saved_items (user_id, product_id) values ('" + A + "', 'brand-x:x1')",
      "delete from user_subscriptions", "select * from rate_limit_events", "select * from sync_runs",
    ]) assert.match((await err(() => asUser(pg, null, sql))) ?? "", /permission denied/, sql);
  });
  test("cannot write the shared catalogue", async () => {
    for (const sql of ["update products set price = 1", "delete from products", "insert into sources (id, source_key, name, original_url, source_type) values ('z','z','z','z','website')"]) {
      assert.match((await err(() => asUser(pg, null, sql))) ?? "", /permission denied/, sql);
    }
  });
  test("see only the public preview", async () => {
    const r = await searchCatalog(null, {});
    assert.deepEqual(r.items.map((i) => i.name), ["Preview Top"]);
    assert.equal(r.preview, true);
    assert.equal((await asUser(pg, null, "select id from products")).length, 1, "RLS hides non-preview products from anon");
    assert.equal((await asUser(pg, null, "select id from sources")).length, 1);
  });
});

describe("signed-in users can't write shared tables either", () => {
  test("products, sources, collections and sync_runs are read-only", async () => {
    for (const sql of ["update products set price = 1", "delete from sources", "insert into collections (id, source_id, external_id, title, url) values ('c','brand-x','c','c','c')",
      "update sync_runs set status = 'ok'", "insert into rate_limit_events (user_id, action) values ('" + A + "', 'x')", "select * from rate_limit_events"]) {
      assert.match((await err(() => asUser(pg, A, sql))) ?? "", /permission denied/, sql);
    }
  });
  test("sources table carries no user information", async () => {
    const cols = (await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'sources'")).rows.map((r) => r.column_name);
    assert.equal(cols.some((c) => /user|owner|created_by|email/.test(c)), false);
  });
});

describe("9–10. persistence across sessions", () => {
  test("a fresh session (new transaction, same verified user id) sees the same data", async () => {
    assert.equal((await myBrands(A)).length, 1);
    assert.deepEqual(await savedIds({ userId: A }), ["brand-x:x1"]);
    assert.equal((await myBrands(B)).length, 1);
  });
});

describe("abuse protection", () => {
  test("follow attempts are rate-limited per user", async () => {
    const C = await createUser(pg, "c@example.com");
    await pg.query("insert into rate_limit_events (user_id, action) select $1, 'follow' from generate_series(1, 30)", [C]);
    assert.equal(await checkRateLimit(C, "follow"), false);
    const r = await followSource(C, { url: "https://brand-y.test" });
    assert.equal(!r.ok && r.status, 429);
  });
  test("invalid URLs are rejected before anything is stored", async () => {
    const r = await followSource(A, { url: "javascript:alert(1)" });
    assert.equal(r.ok, false);
    assert.equal((await followSource(A, { url: "http://localhost:3000" })).ok, false);
  });
  test("server-side fetches refuse private networks (SSRF)", async () => {
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://[::1]/", "http://localhost/", "https://brand.test:8443/"]) {
      assert.ok(await err(() => assertPublicUrl(u)), u);
    }
  });
});

describe("brand mixing in the feed (signed-in pagination)", () => {
  test("paging through everything: every product exactly once, mixed while several brands remain", async () => {
    const D = await createUser(pg, "d@example.com");
    // Two batch-published brands: 12 newest from one, then 8 from the other.
    await importedSource("https://mix-one.test/", Array.from({ length: 12 }, (_, i) => product(`m1-${i}`, `One Top ${i}`, { sourcePublishedAt: `2026-10-${String(20 - Math.floor(i / 6)).padStart(2, "0")}T0${i % 6}:00:00.000Z` })));
    await importedSource("https://mix-two.test/", Array.from({ length: 8 }, (_, i) => product(`m2-${i}`, `Two Top ${i}`, { sourcePublishedAt: `2026-09-0${1 + (i % 8)}T00:00:00.000Z` })));
    for (const u of ["https://mix-one.test/", "https://mix-two.test/"]) assert.ok((await followSource(D, { url: u })).ok);
    const seen: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await searchCatalog({ userId: D }, { page, limit: 5 });
      seen.push(...r.items.map((i) => i.id));
      assert.equal(r.total, 20);
      if (!r.hasMore) break;
    }
    assert.equal(seen.length, 20, "all products reached through pagination");
    assert.equal(new Set(seen).size, 20, "no product repeated across pages");
    const brands = seen.map((id) => id.split(":")[0]);
    const firstTen = brands.slice(0, 10);
    assert.ok(firstTen.filter((b, i) => i && b === firstTen[i - 1]).length <= 2, `early feed mixes brands: ${firstTen.join(" ")}`);
    // Following just one brand: plain newest-first order.
    await unfollow(D, "mix-two");
    const solo = await searchCatalog({ userId: D }, { limit: 12 });
    const dates = solo.items.map((i) => i.releasedAt!);
    assert.equal(solo.items.length, 12);
    assert.ok(dates.every((d, i) => !i || dates[i - 1] >= d), "single brand: plain newest-first order");
    // Explicit sorts are never reshuffled.
    const byPrice = await searchCatalog({ userId: D }, { sort: "price_asc", limit: 12 });
    assert.ok(byPrice.items.every((p, i, a) => !i || (a[i - 1].price ?? 0) <= (p.price ?? 0)), "price sort intact");
  });
});

describe("ingestion semantics on Postgres", () => {
  test("re-import dedupes; partial runs never remove; complete runs hide (not delete) missing products", async () => {
    const s = (await pg.query<SourceRow>("select * from sources where id = 'brand-y'")).rows[0];
    const host = "brand-y.test";
    const fix = (p: NormalizedProduct) => ({ ...p, url: p.url.replace("example.test", host) });
    let c = await upsertProducts(s, [fix(product("y1", "Wide Leg Trousers")), fix(product("y2", "Slip Dress"))], true);
    assert.deepEqual([c.created, c.updated, c.removed], [0, 2, 0]);
    c = await upsertProducts(s, [fix(product("y1", "Wide Leg Trousers"))], false);
    assert.equal(c.removed, 0);
    c = await upsertProducts(s, [fix(product("y1", "Wide Leg Trousers"))], true);
    assert.equal(c.removed, 1);
    const y2 = (await pg.query<{ removed_at: Date | null }>("select removed_at from products where id = 'brand-y:y2'")).rows[0];
    assert.ok(y2?.removed_at, "kept, marked removed");
    assert.equal((await searchCatalog({ userId: B }, {})).items.some((i) => i.id === "brand-y:y2"), false);
  });
  test("search finds tops/trousers by garment word, attributes in descriptions", async () => {
    const s = (await pg.query<SourceRow>("select * from sources where id = 'brand-x'")).rows[0];
    await upsertProducts(s, [
      product("x1", "Linen Shirt"), product("x2", "Silver Hoop Earrings"),
      product("x3", "Novaro Pants", { description: "Breezy linen pants." }),
      product("x4", "Tapered Trousers", { description: "Pair it with a crop top." }),
    ].map((p) => ({ ...p, url: p.url.replace("example.test", "brand-x.test") })), true);
    const names = async (q: string) => (await searchCatalog({ userId: A }, { q })).items.map((i) => i.name).sort();
    assert.deepEqual(await names("linen trousers"), ["Novaro Pants"]);
    // A's own private manual "Corset Top" matches too (and survived the complete re-import above).
    assert.deepEqual(await names("tops"), ["DM-to-order Corset Top", "Linen Shirt"], "a description mention of 'top' doesn't match");
    assert.deepEqual(await names("silver earrings"), ["Silver Hoop Earrings"]);
    assert.deepEqual(await names("brand-x"), ["DM-to-order Corset Top", "Linen Shirt", "Novaro Pants", "Silver Hoop Earrings", "Tapered Trousers"]);
  });
});
