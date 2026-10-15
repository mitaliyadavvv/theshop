/**
 * Sync from the command line.
 *   npm run sync                 # sources whose interval has elapsed
 *   npm run sync -- --all        # every followed/preview source, now
 *   npm run sync -- sundazed the-rok
 */
import "./_env";
import { syncDueSources, syncSource } from "../src/server/ingest/pipeline";
import { getDb } from "../src/server/db";

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));

(async () => {
  const t0 = Date.now();
  const results = [];
  if (ids.length) for (const id of ids) results.push({ id, outcome: await syncSource(id, "cli") });
  else results.push(...await syncDueSources("cli", { force: args.includes("--all") }));
  for (const r of results) console.log(`${r.outcome.status.padEnd(8)} ${r.id.padEnd(18)} ${r.outcome.message}`);
  console.log(`\n${results.length} source(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  for (const s of await getDb().query<{ name: string; status: string; product_count: number; platform: string | null }>(
    "select name, status, product_count, platform from sources order by name")) {
    console.log(`${s.name.padEnd(18)} ${s.status.padEnd(11)} ${String(s.product_count).padStart(4)}  ${s.platform ?? "-"}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
