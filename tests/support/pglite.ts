import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { setDb, type Db, type Queryable } from "../../src/server/db";

/**
 * A real Postgres (PGlite) with a Supabase-like auth shim and our actual migrations applied,
 * wired in as the app's database. RLS, grants and roles behave as in Postgres.
 */
export async function setupTestDb() {
  const pg = new PGlite();
  await pg.exec(fs.readFileSync(path.join(process.cwd(), "tests/support/supabase-shim.sql"), "utf8"));
  const dir = path.join(process.cwd(), "supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await pg.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const wrap = (t: { query: PGlite["query"] }): Queryable => ({
    query: async <T,>(text: string, params: unknown[] = []) => (await t.query<T>(text, params)).rows,
  });
  const db: Db = { ...wrap(pg), tx: (fn) => pg.transaction((t) => fn(wrap(t))) };
  setDb(db);
  return { pg, db };
}

/** Run raw SQL as a given user (or anon) — what a malicious client could do with the anon key + their JWT. */
export async function asUser<T>(pg: PGlite, userId: string | null, sql: string, params: unknown[] = []) {
  return pg.transaction(async (t) => {
    await t.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await t.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" })]);
    return (await t.query<T>(sql, params)).rows;
  });
}

export async function createUser(pg: PGlite, email: string) {
  return (await pg.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email])).rows[0].id;
}
