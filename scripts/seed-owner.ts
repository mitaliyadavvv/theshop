/**
 * Add the initial brand collection (data/sources.seed.json) to ONE account — yours.
 * Safe to re-run: existing subscriptions are left alone. Never touches other accounts.
 *   npm run seed:owner -- you@example.com
 * The account must already exist (sign up in the app first).
 */
import "./_env";
import fs from "node:fs";
import postgres from "postgres";

const email = process.argv.slice(2).find((a) => a.includes("@"));
if (!email) { console.error("Usage: npm run seed:owner -- you@example.com"); process.exit(1); }
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL in .env.local"); process.exit(1); }
const sql = postgres(url, { prepare: false, max: 1 });
const seed = JSON.parse(fs.readFileSync("data/sources.seed.json", "utf8")).sources as { id: string; originalUrl: string }[];

(async () => {
  const users = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${email})`;
  if (users.length !== 1) throw new Error(`No account found for ${email}. Sign up in the app first, then re-run.`);
  const userId = users[0].id;
  let added = 0, missing: string[] = [];
  for (const s of seed) {
    const src = await sql<{ id: string; canonical_url: string | null }[]>`select id, canonical_url from sources where id = ${s.id}`;
    if (!src.length) { missing.push(s.id); continue; }
    const r = await sql`insert into user_subscriptions (user_id, source_id, original_url, canonical_url)
      values (${userId}, ${s.id}, ${s.originalUrl}, ${src[0].canonical_url}) on conflict (user_id, source_id) do nothing returning id`;
    added += r.length;
  }
  const [{ n }] = await sql`select count(*)::int n from user_subscriptions where user_id = ${userId}`;
  console.log(`${email}: ${added} brands added now, ${n} in collection.`);
  if (missing.length) console.log(`Not in registry yet (run db:import-sqlite first): ${missing.join(", ")}`);
  await sql.end();
})().catch(async (e) => { console.error(e.message ?? e); await sql.end(); process.exit(1); });
