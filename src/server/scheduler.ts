import { syncDueSources } from "./ingest/pipeline";

declare global {
  // eslint-disable-next-line no-var
  var __shopScheduler: NodeJS.Timeout | undefined;
}

/**
 * Lightweight scheduler: every SYNC_TICK_MINUTES, sync sources whose own interval
 * (default SYNC_INTERVAL_HOURS = 24) has elapsed. Swap for cron + POST /api/sync
 * or a job queue when deploying somewhere without a long-lived process.
 */
export function startScheduler() {
  if (globalThis.__shopScheduler) return;
  const tickMs = Math.max(1, Number(process.env.SYNC_TICK_MINUTES ?? 15)) * 60_000;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const results = await syncDueSources("schedule");
      if (results.length) console.log(`[scheduler] synced ${results.map((r) => `${r.id}:${r.outcome.status}`).join(", ")}`);
    } catch (e) {
      console.error("[scheduler]", e);
    } finally {
      busy = false;
    }
  };
  globalThis.__shopScheduler = setInterval(tick, tickMs);
  setTimeout(tick, 30_000); // first check shortly after boot, off the request path
}
