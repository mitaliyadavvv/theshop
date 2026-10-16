import { privateJson } from "@/server/http-response";
import { after } from "next/server";
import { syncSource } from "@/server/ingest/pipeline";
import { getSourceById, isFollowing } from "@/server/registry";
import { checkRateLimit, LIMITS } from "@/server/rate-limit";
import { getSessionUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Manual refresh / retry — only for brands you follow, rate-limited per user and per source. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const id = (await params).id;
  if (!(await isFollowing(user.id, id))) return privateJson({ error: "Not in your brands." }, { status: 404 });
  const s = await getSourceById(id);
  if (!s) return privateJson({ error: "Not found" }, { status: 404 });
  if (s.ingestion_method === "manual") return privateJson({ error: "This source is managed manually." }, { status: 400 });
  if (s.sync_locked_until && new Date(s.sync_locked_until).getTime() > Date.now()) return privateJson({ status: "already_running" }, { status: 202 });
  const last = s.last_attempted_sync ? new Date(s.last_attempted_sync).getTime() : 0;
  if (Date.now() - last < LIMITS.sourceCooldownMinutes * 60_000) {
    return privateJson({ error: `This brand was checked in the last ${LIMITS.sourceCooldownMinutes} minutes.` }, { status: 429 });
  }
  if (!(await checkRateLimit(user.id, "sync"))) return privateJson({ error: "Too many refreshes. Try again later." }, { status: 429 });
  after(() => syncSource(id, "manual").then(() => undefined));
  return privateJson({ status: "started" }, { status: 202 });
}
