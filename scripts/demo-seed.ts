/**
 * Clearly-labelled sample products for layout testing (is_demo; hidden unless DEMO_MODE=on).
 *   npm run demo:seed            # add
 *   npm run demo:seed -- --remove
 */
import "./_env";
import { getDb } from "../src/server/db";
import { categoryLabel } from "../src/lib/categories";

(async () => {
  const db = getDb();
  if (process.argv.includes("--remove")) {
    await db.query("delete from sources where id = 'demo-samples'");
    console.log("Removed demo samples."); process.exit(0);
  }
  await db.query(`insert into sources (id, source_key, name, original_url, canonical_url, host, source_type, platform, ingestion_method,
      status, status_detail, is_demo) values ('demo-samples','demo:samples','Demo samples','https://example.com/','https://example.com/',
      'example.com','website','demo','manual','manual','Sample data for development — not a real brand.', true) on conflict do nothing`);
  const items = [["Sample linen shirt", "tops", 1800], ["Sample wide-leg trousers", "bottoms", 2400], ["Sample slip dress", "dresses", 3200],
    ["Sample midi skirt", "skirts", 2100], ["Sample co-ord set", "coords", 4200], ["Sample silver hoop earrings", "jewellery", 900]] as const;
  for (const [i, [name, category, price]] of items.entries()) {
    await db.query(`insert into products (id, source_id, external_id, name, brand_name, category, category_label_hint, category_basis, url,
        price, currency, source_type, provenance, is_demo) values ($1,'demo-samples',$2,$3,'Demo samples',$4,$5,'manual',$6,$7,'INR','website','manual:demo',true)
        on conflict do nothing`, [`demo-samples:sample-${i}`, `sample-${i}`, name, category, categoryLabel(category), `https://example.com/sample-${i}`, price]);
  }
  console.log(`Added ${items.length} sample products. Set DEMO_MODE=on (and follow "Demo samples") to see them.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
