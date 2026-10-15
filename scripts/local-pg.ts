/**
 * Dev/test only: a throwaway local Postgres (PGlite over a TCP socket) with the Supabase
 * auth shim + our migrations, for running the app without a Supabase project.
 * Sign-in will NOT work against it (no Supabase Auth) — signed-out preview only.
 *   npx tsx scripts/local-pg.ts   → DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

(async () => {
  const db = await PGlite.create();
  await db.exec(fs.readFileSync("tests/support/supabase-shim.sql", "utf8"));
  const dir = "supabase/migrations";
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  const server = new PGLiteSocketServer({ db, port: 54329, host: "127.0.0.1" });
  await server.start();
  console.log("local postgres ready on 127.0.0.1:54329");
})();
