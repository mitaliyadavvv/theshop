/**
 * Re-apply category rules (and so the search document, via trigger) from stored data.
 * No network. Run after changing src/server/ingest/normalize.ts:  npm run reindex
 */
import "./_env";
import { getDb } from "../src/server/db";
import { inferCategory } from "../src/server/ingest/normalize";
import { categoryLabel } from "../src/lib/categories";

(async () => {
  const db = getDb();
  const rows = await db.query<{ id: string; name: string; tags: string[]; source_category: string | null; category: string; category_basis: string | null }>(
    "select id, name, tags, source_category, category, category_basis from products where category_basis is distinct from 'manual'");
  const changes = rows.map((r) => ({ r, c: inferCategory({ productType: r.source_category, tags: r.tags, name: r.name }) }))
    .filter(({ r, c }) => c.category !== r.category)
    .map(({ r, c }) => ({ id: r.id, category: c.category, basis: c.basis, label: categoryLabel(c.category) }));
  if (changes.length) await db.query(
    `update products p set category = r.category, category_basis = r.basis, category_label_hint = r.label
       from jsonb_to_recordset($1::text::jsonb) as r(id text, category text, basis text, label text) where p.id = r.id`, [JSON.stringify(changes)]);
  // Touch everything so the search trigger rebuilds documents (e.g. after brand renames).
  await db.query("update products p set brand_name = s.name from sources s where s.id = p.source_id");
  console.log(`Reindexed ${rows.length} products; ${changes.length} changed category.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
