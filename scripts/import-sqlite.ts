/**
 * One-time, repeatable migration of the local SQLite catalogue into Postgres.
 *  - Never modifies the SQLite file; reads a backup copy.
 *  - Upserts (safe to re-run); keeps first-seen dates, release dates and sync history.
 *  - Marks the initial registry sources as public_preview (signed-out preview + suggestions).
 *    Pass --no-preview to skip that. Products/brands are NOT given to any user here —
 *    use `npm run seed:owner` to add them to your own account.
 *   npm run db:import-sqlite [-- path/to/backup.db] [--no-preview]
 */
import "./_env";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import { parseSourceUrl } from "../src/server/url";
import { sourceKeyForParsed } from "../src/server/source-key";
import { categoryLabel } from "../src/lib/categories";

const args = process.argv.slice(2);
const preview = !args.includes("--no-preview");
const file = args.find((a) => a.endsWith(".db")) ?? (() => {
  const b = fs.readdirSync("backups").filter((f) => f.endsWith(".db")).sort().pop();
  if (!b) throw new Error("No backup .db in backups/ — pass a path.");
  return path.join("backups", b);
})();
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL in .env.local"); process.exit(1); }

const lite = new DatabaseSync(file, { readOnly: true });
const pg = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const seedIds = new Set((JSON.parse(fs.readFileSync("data/sources.seed.json", "utf8")).sources as { id: string }[]).map((s) => s.id));
const all = <T,>(q: string) => lite.prepare(q).all().map((r) => ({ ...(r as object) })) as T[];
const ts = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

(async () => {
  console.log(`Reading ${file}`);
  const sources = all<Record<string, string | number | null>>("select * from sources where is_demo = 0");
  const products = all<Record<string, string | number | null>>("select * from products where is_demo = 0 and provenance not like 'manual:%'");
  const collections = all<Record<string, string | number | null>>("select * from collections");
  const runs = all<Record<string, string | number | null>>("select * from sync_runs");

  await pg.begin(async (tx) => {
    for (const s of sources) {
      const p = parseSourceUrl(String(s.original_url));
      if (!p.ok) { console.warn(`skip source ${s.id}: ${p.error}`); continue; }
      const key = sourceKeyForParsed(p, s.scope === "collection" ? "collection" : "store");
      await tx`insert into sources (id, source_key, name, original_url, canonical_url, host, source_type, platform, ingestion_method,
          scope, collection_handle, status, status_detail, verified, logo_url, sync_interval_hours, last_attempted_sync,
          last_successful_sync, baseline_completed_at, product_count, public_preview, notes, created_at, updated_at)
        values (${s.id}, ${key}, ${s.name}, ${s.original_url}, ${s.canonical_url}, ${s.host}, ${s.source_type}, ${s.platform},
          ${s.ingestion_method}, ${s.scope}, ${s.collection_handle}, ${s.status === "syncing" ? "ok" : s.status}, ${s.status_detail},
          ${!!s.verified}, ${s.logo_url}, ${s.sync_interval_hours}, ${ts(s.last_attempted_sync)}, ${ts(s.last_successful_sync)},
          ${ts(s.baseline_completed_at)}, ${s.product_count}, ${preview && seedIds.has(String(s.id))}, ${s.notes},
          ${ts(s.created_at)}, ${ts(s.updated_at)})
        on conflict (id) do update set public_preview = excluded.public_preview or sources.public_preview`;
    }
    const names = new Map(sources.map((s) => [s.id, s.name]));
    for (let i = 0; i < products.length; i += 200) {
      const chunk = products.slice(i, i + 200).map((p) => ({
        ...p, brand_name: names.get(p.source_id) ?? "", category_label_hint: categoryLabel(String(p.category)),
        tags: JSON.parse(String(p.tags ?? "[]")), image_urls: JSON.parse(String(p.image_urls ?? "[]")),
        available: p.available == null ? null : p.available === 1, raw: p.raw ? JSON.parse(String(p.raw)) : null,
        source_published_at: ts(p.source_published_at), source_created_at: ts(p.source_created_at), released_at: ts(p.released_at),
        first_seen_at: ts(p.first_seen_at), last_checked_at: ts(p.last_checked_at), removed_at: ts(p.removed_at),
      }));
      await tx.unsafe(`insert into products (id, source_id, external_id, handle, name, brand_name, description, category, category_label_hint,
          category_basis, source_category, tags, vendor, image_url, image_urls, url, price, price_max, currency, original_price, available,
          source_published_at, source_created_at, released_at, released_basis, first_seen_at, last_checked_at, removed_at,
          source_type, provenance, last_ingest_status, raw)
        select r.id, r.source_id, r.external_id, r.handle, r.name, r.brand_name, r.description, r.category, r.category_label_hint,
          r.category_basis, r.source_category, array(select jsonb_array_elements_text(r.tags)), r.vendor, r.image_url,
          array(select jsonb_array_elements_text(r.image_urls)), r.url, r.price, r.price_max, r.currency, r.original_price, r.available,
          r.source_published_at, r.source_created_at, r.released_at, r.released_basis, r.first_seen_at, r.last_checked_at, r.removed_at,
          r.source_type, r.provenance, r.last_ingest_status, r.raw
        from jsonb_to_recordset($1::text::jsonb) as r(id text, source_id text, external_id text, handle text, name text, brand_name text,
          description text, category text, category_label_hint text, category_basis text, source_category text, tags jsonb, vendor text,
          image_url text, image_urls jsonb, url text, price float8, price_max float8, currency text, original_price float8, available boolean,
          source_published_at timestamptz, source_created_at timestamptz, released_at timestamptz, released_basis text,
          first_seen_at timestamptz, last_checked_at timestamptz, removed_at timestamptz, source_type text, provenance text,
          last_ingest_status text, raw jsonb)
        on conflict (id) do nothing`, [JSON.stringify(chunk)]);
    }
    for (const c of collections) {
      await tx`insert into collections (id, source_id, external_id, title, handle, url, image_url, products_count, published_at, first_seen_at, last_checked_at)
        values (${c.id}, ${c.source_id}, ${c.external_id}, ${c.title}, ${c.handle}, ${c.url}, ${c.image_url}, ${c.products_count},
          ${ts(c.published_at)}, ${ts(c.first_seen_at)}, ${ts(c.last_checked_at)}) on conflict (id) do nothing`;
    }
    for (const r of runs) {   // dedupe on (source, start time) so re-runs don't duplicate history
      await tx`insert into sync_runs (source_id, trigger, started_at, finished_at, status, products_seen, products_new, products_updated,
          products_removed, requests, error, warnings)
        select ${r.source_id}, ${r.trigger}, ${ts(r.started_at)}, ${ts(r.finished_at)}, ${r.status === "running" ? "error" : r.status},
          ${r.products_seen}, ${r.products_new}, ${r.products_updated}, ${r.products_removed}, ${r.requests}, ${r.error},
          ${String(r.warnings ?? "[]")}::text::jsonb
        where exists (select 1 from sources where id = ${r.source_id})
          and not exists (select 1 from sync_runs where source_id = ${r.source_id} and started_at = ${ts(r.started_at)})`;
    }
  });

  // Verify.
  const [{ s }] = await pg`select count(*)::int s from sources`;
  const [{ p }] = await pg`select count(*)::int p from products where owner_user_id is null`;
  const [{ c }] = await pg`select count(*)::int c from collections`;
  const [{ r: rn }] = await pg`select count(*)::int r from sync_runs`;
  const missing = (await pg`select id from products where id = any(${products.map((x) => String(x.id))})`).length;
  console.log(`SQLite: ${sources.length} sources, ${products.length} products, ${collections.length} collections, ${runs.length} sync runs`);
  console.log(`Postgres now: ${s} sources, ${p} products, ${c} collections, ${rn} sync runs`);
  console.log(missing === products.length ? "✓ every SQLite product is present in Postgres" : `✗ ${products.length - missing} products missing`);
  await pg.end();
  if (missing !== products.length) process.exit(1);
})().catch(async (e) => { console.error(e); await pg.end(); process.exit(1); });
