import "server-only";
import crypto from "node:crypto";
import { getDb, withViewer, type Queryable } from "./db";
import { parseSourceUrl, slugify, type ParsedSourceUrl } from "./url";
import { inferCategory } from "./ingest/normalize";
import { categoryLabel } from "@/lib/categories";
import { checkRateLimit, LIMITS } from "./rate-limit";
import { sourceKeyForParsed } from "./source-key";

export type SourceRow = {
  id: string; source_key: string; name: string; original_url: string; canonical_url: string | null; host: string | null;
  source_type: "website" | "collection" | "social"; platform: string | null; ingestion_method: string | null;
  scope: "store" | "collection"; collection_handle: string | null;
  status: "pending" | "syncing" | "ok" | "partial" | "error" | "manual" | "unsupported";
  status_detail: string | null; verified: boolean; logo_url: string | null; sync_interval_hours: number | null;
  last_attempted_sync: Date | string | null; last_successful_sync: Date | string | null; baseline_completed_at: Date | string | null;
  product_count: number; public_preview: boolean; is_demo: boolean; notes: string | null; sync_locked_until: Date | string | null;
  created_at: Date | string; updated_at: Date | string;
};

export type SyncRunRow = {
  id: number | bigint; source_id: string; trigger: string; started_at: Date; finished_at: Date | null; status: string;
  products_seen: number; products_new: number; products_updated: number; products_removed: number;
  requests: number; error: string | null; warnings: string[];
};

export type SubscriptionRow = {
  id: string; user_id: string; source_id: string; original_url: string; canonical_url: string | null;
  preferences: Record<string, unknown>; created_at: Date | string;
};

type OkParsed = Extract<ParsedSourceUrl, { ok: true }>;

export const sourceKeyFor = (p: OkParsed, scope: "store" | "collection") => sourceKeyForParsed(p, scope);

function guessName(host: string) {
  const base = host.split(".")[0].replace(/^(shop|wear|the)(?=[a-z]{3,})/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function getSourceById(id: string) {
  return (await getDb().query<SourceRow>("select * from sources where id = $1", [id]))[0];
}

/**
 * Find the shared registry entry for a URL, creating it if nobody has added it yet.
 * Privileged: the registry is not writable by users directly.
 */
export async function findOrCreateSource(p: OkParsed, name?: string): Promise<{ source: SourceRow; created: boolean }> {
  const db = getDb();
  const scope = p.social ? "store" : p.collectionHandle ? "collection" : "store";
  const key = sourceKeyFor(p, scope);
  const existing = (await db.query<SourceRow>("select * from sources where source_key = $1", [key]))[0];
  if (existing) return { source: existing, created: false };

  const display = name?.trim().slice(0, 80) || (p.social ? p.canonical.split("/").filter(Boolean).pop() ?? p.host : guessName(p.host));
  let id = slugify(scope === "collection" ? `${display}-${p.collectionHandle}` : display);
  if ((await db.query("select 1 from sources where id = $1", [id])).length) id = `${id}-${crypto.randomBytes(3).toString("hex")}`;
  const social = p.social;
  const rows = await db.query<SourceRow>(
    `insert into sources (id, source_key, name, original_url, canonical_url, host, source_type, platform, ingestion_method,
       scope, collection_handle, status, status_detail)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (source_key) do nothing returning *`,
    [id, key, display, p.original, p.canonical, p.host, social ? "social" : scope === "collection" ? "collection" : "website",
      social, social ? "manual" : null, scope, scope === "collection" ? p.collectionHandle : null,
      social ? "manual" : "pending",
      social ? `${social[0].toUpperCase()}${social.slice(1)} profile — not scraped. Add products manually.` : "Checking for a product feed…"],
  );
  if (rows[0]) return { source: rows[0], created: true };
  // Lost a race with another request creating the same source.
  return { source: (await db.query<SourceRow>("select * from sources where source_key = $1", [key]))[0], created: false };
}

export type FollowResult =
  | { ok: true; subscription: SubscriptionRow; source: SourceRow; needsSync: boolean }
  | { ok: false; status: number; error: string; subscriptionId?: string };

/**
 * Add a brand to the user's collection (Add Brand workflow).
 * `userId` must come from the verified session.
 */
export async function followSource(userId: string, input: { url?: string; sourceId?: string; name?: string }): Promise<FollowResult> {
  let source: SourceRow | undefined;
  let originalUrl: string;
  let canonical: string | null;

  const count = await withViewer({ userId }, (q) => q.query<{ n: number }>("select count(*)::int n from user_subscriptions"));
  if (count[0].n >= LIMITS.maxSubscriptions) return { ok: false, status: 400, error: `You can follow up to ${LIMITS.maxSubscriptions} brands.` };
  if (!(await checkRateLimit(userId, "follow"))) return { ok: false, status: 429, error: "You're adding brands very quickly. Try again in a little while." };

  if (input.sourceId) {
    // Following an existing registry entry (e.g. a suggestion).
    source = await getSourceById(input.sourceId);
    if (!source) return { ok: false, status: 404, error: "That brand isn't in the registry." };
    originalUrl = source.original_url;
    canonical = source.canonical_url;
  } else {
    const parsed = parseSourceUrl(input.url ?? "");
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    originalUrl = parsed.original;
    canonical = parsed.canonical;
    // Already following? Check before creating anything.
    const key = sourceKeyFor(parsed, parsed.social ? "store" : parsed.collectionHandle ? "collection" : "store");
    const mine = await withViewer({ userId }, (q) => q.query<{ id: string; name: string }>(
      "select u.id, s.name from user_subscriptions u join sources s on s.id = u.source_id where s.source_key = $1", [key]));
    if (mine[0]) return { ok: false, status: 409, error: `${mine[0].name} is already in your brands.`, subscriptionId: mine[0].id };
    ({ source } = await findOrCreateSource(parsed, input.name));
  }

  // Insert as the user: RLS guarantees the row belongs to them.
  const inserted = await withViewer({ userId }, (q) => q.query<SubscriptionRow>(
    `insert into user_subscriptions (user_id, source_id, original_url, canonical_url)
     values (auth.uid(), $1, $2, $3) on conflict (user_id, source_id) do nothing returning *`,
    [source!.id, originalUrl, canonical]));
  if (!inserted[0]) return { ok: false, status: 409, error: `${source!.name} is already in your brands.` };

  // Reuse shared data: only new or never-imported sources need an import job.
  // (and not one that was attempted moments ago — following/unfollowing can't be used to hammer a site).
  const lastTry = source!.last_attempted_sync ? new Date(source!.last_attempted_sync).getTime() : 0;
  const needsSync = source!.ingestion_method !== "manual" && !source!.last_successful_sync
    && Date.now() - lastTry > LIMITS.sourceCooldownMinutes * 60_000;
  return { ok: true, subscription: inserted[0], source: source!, needsSync };
}

/** Remove a brand from *this user's* collection. Shared products and other users are untouched. */
export async function unfollow(userId: string, subscriptionOrSourceId: string) {
  const rows = await withViewer({ userId }, (q) => q.query<{ id: string }>(
    "delete from user_subscriptions where id::text = $1 or source_id = $1 returning id", [subscriptionOrSourceId]));
  return rows.length > 0;
}

export async function isFollowing(userId: string, sourceId: string) {
  const r = await withViewer({ userId }, (q) => q.query("select 1 from user_subscriptions where source_id = $1", [sourceId]));
  return r.length > 0;
}

export async function updatePreferences(userId: string, subscriptionId: string, prefs: Record<string, unknown>) {
  const r = await withViewer({ userId }, (q) => q.query<SubscriptionRow>(
    "update user_subscriptions set preferences = $2::text::jsonb where id::text = $1 returning *", [subscriptionId, JSON.stringify(prefs)]));
  return r[0] ?? null;
}

/**
 * Manually supplied product (social / unsupported sources). Private to the user who added it
 * (owner_user_id), because it's user-supplied content rather than data from the brand.
 */
export async function addManualProduct(userId: string, sourceId: string, input: {
  url: string; name: string; imageUrl?: string; price?: number | null; currency?: string; category?: string;
}) {
  if (!(await isFollowing(userId, sourceId))) return { error: "Follow this brand first." };
  const s = await getSourceById(sourceId);
  if (!s) return { error: "Source not found." };
  let url: URL;
  try { url = new URL(input.url); } catch { return { error: "Product link must be a valid URL." }; }
  if (!/^https?:$/.test(url.protocol)) return { error: "Product link must be http(s)." };
  const name = input.name?.trim().slice(0, 200);
  if (!name) return { error: "Product name is required." };
  let image: string | null = null;
  if (input.imageUrl) {
    try { const iu = new URL(input.imageUrl); if (!/^https?:$/.test(iu.protocol)) throw 0; image = iu.toString(); }
    catch { return { error: "Image URL is invalid." }; }
  }
  if (!(await checkRateLimit(userId, "manual_product"))) return { error: "Too many products added recently. Try again later." };
  const externalId = "manual-" + crypto.createHash("sha1").update(`${userId}:${url}`).digest("hex").slice(0, 16);
  const inferred = inferCategory({ productType: null, tags: [], name });
  const category = input.category && input.category !== "" ? input.category : inferred.category;
  const rows = await getDb().query<{ id: string }>(
    `insert into products (id, source_id, external_id, name, brand_name, category, category_label_hint, category_basis, image_url,
       image_urls, url, price, currency, source_type, provenance, last_ingest_status, owner_user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'manual:user','manual',$15)
     on conflict (source_id, external_id) do nothing returning id`,
    [`${sourceId}:${externalId}`, sourceId, externalId, name, s.name, category, categoryLabel(category),
      input.category ? "manual" : inferred.basis, image, image ? [image] : [], url.toString(),
      input.price ?? null, input.price != null ? input.currency || "INR" : null, s.source_type, userId],
  );
  if (!rows[0]) return { error: "You've already added that product link." };
  return { ok: true as const, id: rows[0].id };
}

/** Registry entries offered to people as one-click follows. */
export async function suggestedSources(q: Queryable) {
  return q.query<SourceRow>(
    `select s.* from sources s where s.public_preview and not s.is_demo
       and not exists (select 1 from user_subscriptions u where u.source_id = s.id)
     order by s.name`);
}
