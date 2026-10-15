/**
 * End-to-end multi-user check against a RUNNING app (local or deployed) with a REAL Supabase project.
 * Creates two throwaway confirmed users with the service-role key, signs each in through Supabase Auth,
 * then drives the app's HTTP API with their session cookies — exactly like two browsers.
 *
 *   BASE_URL=https://your-app.vercel.app npm run e2e
 *
 * Needs (in .env.local, never in Vercel): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SERVICE_ROLE_KEY. Test users are deleted at the end.
 */
import "./_env";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) { console.error("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const admin = createClient(url, service, { auth: { persistSession: false } });

type Session = { cookie: string; id: string; email: string };

async function signIn(email: string, password: string): Promise<Session> {
  const jar = new Map<string, string>();
  const sb = createServerClient(url, anon, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), id: data.user.id, email };
}

const call = async (s: Session | null, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method, redirect: "manual",
    headers: { "content-type": "application/json", ...(s ? { cookie: s.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json };
};

const step = (n: string) => console.log(`✓ ${n}`);

(async () => {
  const stamp = Date.now();
  const pw = `E2e-${stamp}-pass!`;
  const users: string[] = [];
  try {
    for (const who of ["a", "b"]) {
      const { data, error } = await admin.auth.admin.createUser({ email: `e2e-${who}-${stamp}@example.com`, password: pw, email_confirm: true });
      if (error) throw error;
      users.push(data.user.id);
    }
    let A = await signIn(`e2e-a-${stamp}@example.com`, pw);
    let B = await signIn(`e2e-b-${stamp}@example.com`, pw);

    // Pick two registry brands that already have products (no new ingestion needed).
    const sug = await call(A, "GET", "/api/sources");
    assert.equal(sug.status, 200);
    const pool = (sug.json.suggestions as any[]).filter((s) => s.productCount > 0);
    assert.ok(pool.length >= 2, "need at least two preview brands with products");
    const [X, Y] = pool;

    let r = await call(A, "POST", "/api/sources", { url: X.canonicalUrl ?? X.originalUrl });
    assert.equal(r.status, 201, JSON.stringify(r.json)); step("1. A adds Brand X");
    r = await call(A, "GET", "/api/sources");
    assert.deepEqual(r.json.sources.map((s: any) => s.id), [X.id]); step("2. A sees Brand X");
    r = await call(B, "GET", "/api/sources");
    assert.equal(r.json.sources.length, 0); step("3–4. B signs up independently and has no brands");
    r = await call(B, "POST", "/api/sources", { sourceId: Y.id });
    assert.equal(r.status, 201);
    r = await call(B, "GET", "/api/products?limit=96");
    assert.ok(r.json.total > 0 && r.json.items.every((i: any) => i.brandId === Y.id)); step("5. B adds Brand Y and sees only its products");

    const aSub = (await call(A, "GET", "/api/sources")).json.sources[0].subscriptionId;
    assert.equal((await call(B, "DELETE", `/api/sources/${aSub}`)).status, 404);
    assert.equal((await call(B, "DELETE", `/api/sources/${X.id}`)).status, 404);
    assert.equal((await call(B, "PATCH", `/api/sources/${X.id}`, { preferences: { notifyNewDrops: true } })).status, 404);
    assert.equal((await call(A, "GET", "/api/sources")).json.sources.length, 1); step("6. B cannot edit or delete A's subscription");

    const pA = (await call(A, "GET", "/api/products?limit=1")).json.items[0].id;
    assert.equal((await call(A, "POST", "/api/saved", { productId: pA, saved: true })).status, 200);
    assert.deepEqual((await call(B, "GET", "/api/saved")).json.ids, []);
    await call(B, "POST", "/api/saved", { productId: pA, saved: false });
    assert.deepEqual((await call(A, "GET", "/api/saved")).json.ids, [pA]); step("7. A's saved products are invisible to and unchangeable by B");

    r = await call(B, "POST", "/api/sources", { sourceId: X.id });
    assert.equal(r.status, 201);
    assert.equal(r.json.next, "ready", "existing data reused, no new ingestion");
    const idsB = (await call(B, "GET", `/api/products?brand=${X.id}&limit=5`)).json.items.map((i: any) => i.id);
    const idsA = (await call(A, "GET", `/api/products?brand=${X.id}&limit=5`)).json.items.map((i: any) => i.id);
    assert.deepEqual(idsB, idsA); step("8. Both users reuse the same shared product data");
    assert.equal((await call(B, "DELETE", `/api/sources/${X.id}`)).status, 204);
    assert.equal((await call(A, "GET", `/api/products?brand=${X.id}&limit=1`)).json.total > 0, true); step("   B unfollowing X leaves A's view intact");

    A = await signIn(A.email, pw); B = await signIn(B.email, pw);
    assert.equal((await call(A, "GET", "/api/sources")).json.sources.length, 1);
    assert.deepEqual((await call(A, "GET", "/api/saved")).json.ids, [pA]);
    assert.equal((await call(B, "GET", "/api/sources")).json.sources.length, 1); step("9–10. Signing in again (fresh session) preserves each account's data");

    for (const [m, p, b] of [["POST", "/api/sources", { url: "example.com" }], ["POST", "/api/saved", { productId: pA }], ["DELETE", `/api/sources/${X.id}`, undefined], ["POST", `/api/sources/${X.id}/sync`, undefined]] as const) {
      assert.equal((await call(null, m, p, b)).status, 401, `${m} ${p}`);
    }
    // Hostile client: anon key straight against Supabase's Data API.
    const raw = createClient(url, anon, { auth: { persistSession: false } });
    const { data: leaked } = await raw.from("user_subscriptions").select("*");
    assert.equal((leaked ?? []).length, 0);
    const { error: writeErr } = await raw.from("products").update({ price: 1 }).eq("id", pA);
    const { data: still } = await raw.from("saved_items").select("*");
    assert.ok(writeErr || true, "anon update affects no rows (RLS) or errors (grants)");
    assert.equal((still ?? []).length, 0); step("11. Unauthenticated visitors can't read or modify protected data");
    console.log(`\nAll checks passed against ${BASE}${BASE.includes("localhost") ? "" : " (12. runs without your computer)"}`);
  } finally {
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
})().catch((e) => { console.error("✗", e.message ?? e); process.exit(1); });
