/**
 * Local / long-lived servers only: start the in-process sync scheduler.
 * On Vercel, scheduled syncs come from Vercel Cron → /api/sync (see vercel.json).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL) return;
  if ((process.env.SYNC_SCHEDULER ?? "off") !== "on" || !process.env.DATABASE_URL) return;
  const { startScheduler } = await import("./server/scheduler");
  startScheduler();
}
