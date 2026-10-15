/**
 * Apply supabase/migrations/*.sql to DATABASE_URL, in order, once each.
 * (Equivalent to `supabase db push`, for when the Supabase CLI isn't installed.
 *  You can also paste each file into the Supabase SQL editor.)
 *   npm run db:migrate
 */
import "./_env";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (or DATABASE_URL_DIRECT) in .env.local"); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const dir = path.join(process.cwd(), "supabase/migrations");

(async () => {
  // Private schema: not exposed through Supabase's Data API.
  await sql`create schema if not exists shop_private`;
  await sql`create table if not exists shop_private.migrations (id text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ id: string }[]>`select id from shop_private.migrations`).map((r) => r.id));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) { console.log(`skip   ${file}`); continue; }
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
      await tx`insert into shop_private.migrations (id) values (${file})`;
    });
    console.log(`apply  ${file}`);
  }
  await sql.end();
})().catch(async (e) => { console.error(e.message ?? e); await sql.end(); process.exit(1); });
