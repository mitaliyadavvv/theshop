import "server-only";
import postgres from "postgres";

/**
 * Minimal database interface so the same SQL runs on Supabase Postgres (postgres.js)
 * in production and on PGlite in tests.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

declare global {
  // eslint-disable-next-line no-var
  var __shopDb: Db | undefined;
}

function fromPostgresJs(sql: postgres.Sql): Db {
  const wrap = (s: postgres.Sql | postgres.TransactionSql): Queryable => ({
    query: async <T,>(text: string, params: unknown[] = []) =>
      (await s.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as unknown as T[],
  });
  return { ...wrap(sql), tx: (fn) => sql.begin((t) => fn(wrap(t))) as Promise<never> };
}

/** Privileged connection (bypasses RLS). Only ingestion/admin code may use it directly. */
export function getDb(): Db {
  if (globalThis.__shopDb) return globalThis.__shopDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example and docs/DEPLOY.md.");
  const sql = postgres(url, {
    prepare: false,            // required for Supabase's transaction pooler (port 6543)
    max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 1 : 5),
    idle_timeout: 20,
    types: { bigint: postgres.BigInt },
    transform: { undefined: null },
  });
  globalThis.__shopDb = fromPostgresJs(sql);
  return globalThis.__shopDb;
}

/** Tests inject a PGlite-backed Db. */
export function setDb(db: Db) { globalThis.__shopDb = db; }

export type Viewer = { userId: string } | null;

/**
 * Run queries as the end user: role `authenticated` (or `anon`) with the verified user id
 * in request.jwt.claims — exactly how Supabase's API runs them — so RLS policies apply.
 * The user id must come from a verified session (see server/auth.ts), never from the client.
 */
export function withViewer<T>(viewer: Viewer, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return getDb().tx(async (q) => {
    if (viewer) {
      if (!/^[0-9a-f-]{36}$/i.test(viewer.userId)) throw new Error("Invalid user id");
      await q.query("set local role authenticated");
      await q.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: viewer.userId, role: "authenticated" })]);
    } else {
      await q.query("set local role anon");
      await q.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    }
    return fn(q);
  });
}

export const iso = (d: unknown): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString();
