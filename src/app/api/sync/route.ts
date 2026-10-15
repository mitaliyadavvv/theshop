import { syncDueSources } from "@/server/ingest/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled sync. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 * Works through due sources (oldest first) within the function's time budget.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await syncDueSources("schedule", { budgetMs: (maxDuration - 40) * 1000 });
  return Response.json({ synced: results.map((r) => ({ id: r.id, status: r.outcome.status })) });
}

export const GET = handle;
export const POST = handle;
