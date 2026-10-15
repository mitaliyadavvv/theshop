import "server-only";
import { iso, withViewer, type Queryable } from "./db";
import { suggestedSources, type SourceRow, type SyncRunRow } from "./registry";
import type { SourceDTO } from "@/lib/types";

type Joined = SourceRow & { subscription_id: string | null; added_at: Date | null; sub_original_url: string | null };

function toDTO(s: Joined, runs: SyncRunRow[]): SourceDTO {
  const syncing = s.status === "syncing" || (!!s.sync_locked_until && new Date(s.sync_locked_until).getTime() > Date.now());
  return {
    subscriptionId: s.subscription_id, addedAt: iso(s.added_at),
    id: s.id, name: s.name, originalUrl: s.sub_original_url ?? s.original_url, canonicalUrl: s.canonical_url, host: s.host,
    sourceType: s.source_type, platform: s.platform, ingestionMethod: s.ingestion_method, scope: s.scope,
    collectionHandle: s.collection_handle, status: s.status, statusDetail: s.status_detail, verified: s.verified,
    logoUrl: s.logo_url, lastAttemptedSync: iso(s.last_attempted_sync), lastSuccessfulSync: iso(s.last_successful_sync),
    productCount: s.product_count, syncing, notes: s.notes, syncIntervalHours: s.sync_interval_hours,
    runs: runs.filter((r) => r.source_id === s.id).slice(0, 5).map((r) => ({
      id: Number(r.id), trigger: r.trigger, startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at), status: r.status,
      seen: r.products_seen, created: r.products_new, removed: r.products_removed, error: r.error,
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
    })),
  };
}

async function runsFor(q: Queryable, ids: string[]) {
  if (!ids.length) return [];
  return q.query<SyncRunRow>(
    `select * from (select r.*, row_number() over (partition by source_id order by started_at desc) rn
       from sync_runs r where source_id = any($1::text[])) x where rn <= 5 order by started_at desc`, [ids]);
}

/** The signed-in user's brands, with each shared source's live status. */
export async function myBrands(userId: string): Promise<SourceDTO[]> {
  return withViewer({ userId }, async (q) => {
    const rows = await q.query<Joined>(
      `select s.*, u.id subscription_id, u.created_at added_at, u.original_url sub_original_url
         from user_subscriptions u join sources s on s.id = u.source_id order by s.name`);
    const runs = await runsFor(q, rows.map((r) => r.id));
    return rows.map((r) => toDTO(r, runs));
  });
}

export async function myBrand(userId: string, sourceId: string): Promise<SourceDTO | null> {
  return (await myBrands(userId)).find((b) => b.id === sourceId) ?? null;
}

/** Preview brands the user doesn't follow yet (one-click follow). */
export async function suggestions(userId: string): Promise<SourceDTO[]> {
  return withViewer({ userId }, async (q) =>
    (await suggestedSources(q)).map((s) => toDTO({ ...s, subscription_id: null, added_at: null, sub_original_url: null }, [])));
}
