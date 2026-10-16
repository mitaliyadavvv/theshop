import "server-only";
import { revalidateTag } from "next/cache";
import { getDb, type Queryable } from "../db";
import { ADAPTERS, adapterFor } from "./adapters";
import { getText } from "./http";
import { inferCategory, isExcludedProduct, releaseDate } from "./normalize";
import { categoryLabel } from "@/lib/categories";
import type { NormalizedCollection, NormalizedProduct, SourceContext } from "./types";
import { SourceError } from "./types";
import type { SourceRow } from "../registry";

const LOCK_MINUTES = 10;
const CHUNK = 200;

async function getSource(q: Queryable, id: string) {
  return (await q.query<SourceRow>("select * from sources where id = $1", [id]))[0];
}

async function updateSource(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await getDb().query(
    `update sources set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/** Best-effort logo: the site's icon link, read from the homepage head. */
async function discoverLogo(origin: string): Promise<string | null> {
  const html = await getText(`${origin}/`);
  if (!html) return null;
  const head = html.slice(0, 200_000);
  const pick = (re: RegExp) => head.match(re)?.[1] ?? null;
  const href =
    pick(/<link[^>]+rel=["'](?:apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i) ??
    pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:apple-touch-icon)["']/i) ??
    pick(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i) ??
    pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
  if (!href) return null;
  try { return new URL(href.replace(/&amp;/g, "&"), `${origin}/`).toString(); } catch { return null; }
}

/** Identify platform + method for a source that hasn't been verified yet. */
export async function detectSource(source: SourceRow) {
  const origin = new URL(source.canonical_url ?? source.original_url).origin;
  for (const adapter of ADAPTERS) {
    const r = await adapter.detect(origin, source.scope === "collection" ? source.collection_handle : null);
    if (r) return { ...r, origin };
  }
  return null;
}

type Counts = { seen: number; created: number; updated: number; removed: number; skipped: number };

const PRODUCT_COLS = `id text, source_id text, external_id text, handle text, name text, brand_name text, description text,
  category text, category_label_hint text, category_basis text, source_category text, tags jsonb, vendor text, image_url text,
  image_urls jsonb, url text, price float8, price_max float8, currency text, original_price float8, available boolean,
  source_published_at timestamptz, source_created_at timestamptz, released_at timestamptz, released_basis text,
  source_type text, provenance text, raw jsonb`;

export async function upsertProducts(source: SourceRow, items: NormalizedProduct[], complete: boolean): Promise<Counts> {
  const db = getDb();
  const counts: Counts = { seen: 0, created: 0, updated: 0, removed: 0, skipped: 0 };
  const afterBaseline = !!source.baseline_completed_at;
  const existing = new Map(
    (await db.query<{ external_id: string; first_seen_at: Date; released_at: Date | null; released_basis: string | null }>(
      "select external_id, first_seen_at, released_at, released_basis from products where source_id = $1 and owner_user_id is null", [source.id],
    )).map((r) => [r.external_id, r]),
  );
  const now = new Date().toISOString();
  const provenance = `${source.ingestion_method}:${new URL(source.canonical_url ?? source.original_url).origin}`;
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const p of items) {
    if (!p.name || !p.url || isExcludedProduct(p.name, p.sourceCategory)) { counts.skipped++; continue; }
    const id = `${source.id}:${p.externalId}`;
    if (seen.has(id)) continue;            // same product on two feed pages
    seen.add(id);
    counts.seen++;
    const prev = existing.get(p.externalId);
    if (prev) counts.updated++; else counts.created++;
    const { category, basis } = inferCategory({ productType: p.sourceCategory, tags: p.tags, name: p.name });
    const firstSeen = prev ? new Date(prev.first_seen_at).toISOString() : now;
    let rel = releaseDate(p, firstSeen, afterBaseline && !prev);
    // A first-seen release date, once assigned, sticks.
    if (!rel.releasedAt && prev?.released_basis === "first_seen" && prev.released_at) {
      rel = { releasedAt: new Date(prev.released_at).toISOString(), basis: "first_seen" };
    }
    rows.push({
      id, source_id: source.id, external_id: p.externalId, handle: p.handle, name: p.name, brand_name: source.name,
      description: p.description, category, category_label_hint: categoryLabel(category), category_basis: basis,
      source_category: p.sourceCategory, tags: p.tags, vendor: p.vendor, image_url: p.imageUrl, image_urls: p.imageUrls,
      url: p.url, price: p.price, price_max: p.priceMax, currency: p.currency, original_price: p.originalPrice,
      available: p.available, source_published_at: p.sourcePublishedAt, source_created_at: p.sourceCreatedAt,
      released_at: rel.releasedAt, released_basis: rel.basis, source_type: source.source_type, provenance, raw: p.raw ?? null,
    });
  }

  await db.tx(async (q) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      await q.query(
        `insert into products (id, source_id, external_id, handle, name, brand_name, description, category, category_label_hint,
           category_basis, source_category, tags, vendor, image_url, image_urls, url, price, price_max, currency, original_price,
           available, source_published_at, source_created_at, released_at, released_basis, source_type, provenance, raw,
           first_seen_at, last_checked_at)
         select r.id, r.source_id, r.external_id, r.handle, r.name, r.brand_name, r.description, r.category, r.category_label_hint,
           r.category_basis, r.source_category, array(select jsonb_array_elements_text(r.tags)), r.vendor, r.image_url,
           array(select jsonb_array_elements_text(r.image_urls)), r.url, r.price, r.price_max, r.currency, r.original_price,
           r.available, r.source_published_at, r.source_created_at, r.released_at, r.released_basis, r.source_type, r.provenance, r.raw,
           now(), now()
         from jsonb_to_recordset($1::text::jsonb) as r(${PRODUCT_COLS})
         on conflict (source_id, external_id) do update set
           handle = excluded.handle, name = excluded.name, brand_name = excluded.brand_name, description = excluded.description,
           category = excluded.category, category_label_hint = excluded.category_label_hint, category_basis = excluded.category_basis,
           source_category = excluded.source_category, tags = excluded.tags, vendor = excluded.vendor, image_url = excluded.image_url,
           image_urls = excluded.image_urls, url = excluded.url, price = excluded.price, price_max = excluded.price_max,
           currency = excluded.currency, original_price = excluded.original_price, available = excluded.available,
           source_published_at = excluded.source_published_at, source_created_at = excluded.source_created_at,
           released_at = excluded.released_at, released_basis = excluded.released_basis, provenance = excluded.provenance,
           raw = excluded.raw, last_checked_at = now(), removed_at = null, last_ingest_status = 'ok'`,
        [JSON.stringify(rows.slice(i, i + CHUNK))],
      );
    }

    // Product re-listed under a new id at the same URL: move saves to the new record, drop the stale one.
    const stale = await q.query<{ old_id: string; new_id: string }>(
      `select o.id old_id, n.id new_id from products o
         join products n on n.source_id = o.source_id and n.url = o.url and n.id <> o.id
        where o.source_id = $1 and o.owner_user_id is null and n.owner_user_id is null
          and o.id not in (select jsonb_array_elements_text($2::text::jsonb)) and n.id in (select jsonb_array_elements_text($2::text::jsonb))`,
      [source.id, JSON.stringify([...seen])],
    );
    for (const s of stale) {
      await q.query(`insert into saved_items (user_id, product_id, saved_at)
                     select user_id, $2, saved_at from saved_items where product_id = $1 on conflict do nothing`, [s.old_id, s.new_id]);
      await q.query("delete from products where id = $1", [s.old_id]);
    }

    // Only a complete run can tell us a product is gone. Gone = hidden, never deleted.
    if (complete) {
      const removed = await q.query<{ id: string }>(
        `update products set removed_at = now(), last_ingest_status = 'removed'
          where source_id = $1 and removed_at is null and owner_user_id is null
            and id not in (select jsonb_array_elements_text($2::text::jsonb)) returning id`,
        [source.id, JSON.stringify([...seen])],
      );
      counts.removed = removed.length;
    }
  });
  return counts;
}

async function upsertCollections(sourceId: string, items: NormalizedCollection[]) {
  if (!items.length) return;
  await getDb().query(
    `insert into collections (id, source_id, external_id, title, handle, url, image_url, products_count, published_at)
     select $1 || ':' || r."externalId", $1, r."externalId", r.title, r.handle, r.url, r."imageUrl", r."productsCount", r."publishedAt"
       from jsonb_to_recordset($2::text::jsonb) as r("externalId" text, title text, handle text, url text, "imageUrl" text, "productsCount" int, "publishedAt" timestamptz)
     on conflict (source_id, external_id) do update set title = excluded.title, handle = excluded.handle, url = excluded.url,
       image_url = excluded.image_url, products_count = excluded.products_count, published_at = excluded.published_at, last_checked_at = now()`,
    [sourceId, JSON.stringify(items)],
  );
}

export type SyncOutcome = { status: "ok" | "partial" | "error" | "skipped"; message: string; runId?: number };
export type SyncTrigger = "schedule" | "manual" | "add" | "cli";

/**
 * Sync one source end to end. Never throws; never deletes previous data on failure.
 * A database lock stops two server instances syncing the same source at once.
 */
export async function syncSource(sourceId: string, trigger: SyncTrigger): Promise<SyncOutcome> {
  const db = getDb();
  const pre = await getSource(db, sourceId);
  if (!pre) return { status: "error", message: "Source not found." };
  if (pre.ingestion_method === "manual") return { status: "skipped", message: "Manual source — nothing to sync automatically." };

  const locked = (await db.query<SourceRow>(
    `update sources set sync_locked_until = now() + interval '${LOCK_MINUTES} minutes', status = 'syncing',
            last_attempted_sync = now(), updated_at = now()
      where id = $1 and (sync_locked_until is null or sync_locked_until < now()) returning *`, [sourceId],
  ))[0];
  if (!locked) return { status: "skipped", message: "A sync for this source is already running." };

  const runId = Number((await db.query<{ id: number }>(
    "insert into sync_runs (source_id, trigger, status) values ($1, $2, 'running') returning id", [sourceId, trigger],
  ))[0].id);
  const finishRun = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    // jsonb columns go through ::text so both drivers send the JSON string unchanged.
    return db.query(`update sync_runs set ${keys.map((k, i) => `${k} = $${i + 2}${k === "warnings" ? "::text::jsonb" : ""}`).join(", ")}, finished_at = now() where id = $1`,
      [runId, ...keys.map((k) => fields[k])]);
  };

  try {
    let current = pre;
    if (!adapterFor(current.ingestion_method)) {
      const found = await detectSource(current);
      if (!found) {
        const msg = "No supported product feed found (checked Shopify products.json and WooCommerce Store API). Products can be added manually.";
        await updateSource(sourceId, { status: "unsupported", status_detail: msg, platform: current.platform ?? "unknown" });
        await finishRun({ status: "error", error: msg });
        return { status: "error", message: msg, runId };
      }
      await updateSource(sourceId, { platform: found.platform, ingestion_method: found.method });
      current = (await getSource(db, sourceId))!;
    }
    const adapter = adapterFor(current.ingestion_method)!;
    const origin = new URL(current.canonical_url ?? current.original_url).origin;
    const ctx: SourceContext = { id: current.id, name: current.name, origin, scope: current.scope, collectionHandle: current.collection_handle };

    const result = await adapter.fetchCatalogue(ctx);
    if (!current.logo_url) {
      const logo = await discoverLogo(origin).catch(() => null);
      if (logo) await updateSource(sourceId, { logo_url: logo });
    }

    const counts = await upsertProducts(current, result.products, result.complete);
    await upsertCollections(sourceId, result.collections);
    const productCount = Number((await db.query<{ n: number }>(
      "select count(*)::int n from products where source_id = $1 and removed_at is null and owner_user_id is null", [sourceId],
    ))[0].n);
    const status = result.complete ? "ok" : "partial";
    const warnings = [...result.warnings];
    if (counts.skipped) warnings.push(`${counts.skipped} non-product listings skipped (gift cards etc.).`);
    await updateSource(sourceId, {
      status, verified: true, product_count: productCount, last_successful_sync: new Date().toISOString(),
      baseline_completed_at: current.baseline_completed_at ?? (result.complete ? new Date().toISOString() : null),
      status_detail: status === "partial" ? warnings.find((w) => w.startsWith("Stopped")) ?? "Partial import." : warnings[0] ?? null,
    });
    await finishRun({
      status, products_seen: counts.seen, products_new: counts.created, products_updated: counts.updated,
      products_removed: counts.removed, requests: result.requests, warnings: JSON.stringify(warnings),
    });
    // Signed-out visitors see a cached preview of public_preview brands: refresh it now
    // rather than waiting for the 5-minute TTL. (No-op outside a Next.js request, e.g. CLI scripts.)
    if (current.public_preview) {
      try { revalidateTag("public-catalog", { expire: 0 }); } catch { /* not running inside Next.js */ }
    }
    return { status, message: `${counts.seen} products (${counts.created} new, ${counts.removed} removed).`, runId };
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError((e as Error).message ?? String(e), "network");
    const friendly =
      err.kind === "robots" ? `Blocked by the site's robots.txt (${err.message}).`
      : err.kind === "blocked" ? err.message
      : err.kind === "rate_limited" ? "The site is rate-limiting requests. Will retry automatically."
      : err.kind === "http" && (err.status === 401 || err.status === 403) ? `Access denied (HTTP ${err.status}). The site may block automated access.`
      : err.kind === "http" && err.status === 404 ? "Product feed not found (HTTP 404). The store may have changed platform."
      : err.message;
    await updateSource(sourceId, { status: "error", status_detail: friendly }).catch(() => {});
    await finishRun({ status: "error", error: friendly }).catch(() => {});
    return { status: "error", message: friendly, runId };
  } finally {
    await db.query(
      `update sources set sync_locked_until = null,
              status = case when status = 'syncing' then (case when last_successful_sync is null then 'pending' else 'ok' end) else status end
        where id = $1`, [sourceId],
    ).catch(() => {});
  }
}

/**
 * Sync automatable sources whose interval has elapsed, oldest first, within a time budget
 * (serverless functions have a maximum duration). Sequential on purpose — politeness.
 */
export async function syncDueSources(trigger: "schedule" | "cli" = "schedule", opts: { force?: boolean; budgetMs?: number } = {}) {
  const started = Date.now();
  const defaultHours = Number(process.env.SYNC_INTERVAL_HOURS ?? 24);
  // Only sources somebody follows (or the public preview set) are worth fetching.
  const rows = await getDb().query<SourceRow>(
    `select s.* from sources s
      where (s.ingestion_method is null or s.ingestion_method <> 'manual') and not s.is_demo
        and (s.public_preview or exists (select 1 from user_subscriptions u where u.source_id = s.id))
      order by s.last_attempted_sync asc nulls first`,
  );
  const results: { id: string; outcome: SyncOutcome }[] = [];
  for (const s of rows) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break;
    if (s.status === "unsupported" && !opts.force) continue;
    // Failed sources (rate limit, outage) retry hourly instead of waiting a full interval.
    const hours = s.status === "error" ? Math.min(1, s.sync_interval_hours ?? defaultHours) : s.sync_interval_hours ?? defaultHours;
    const last = s.last_attempted_sync ? new Date(s.last_attempted_sync).getTime() : 0;
    if (!opts.force && Date.now() - last < hours * 3600_000) continue;
    results.push({ id: s.id, outcome: await syncSource(s.id, trigger) });
  }
  return results;
}
