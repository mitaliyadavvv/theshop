import { privateJson } from "@/server/http-response";
import { after } from "next/server";
import { syncSource } from "@/server/ingest/pipeline";
import { followSource } from "@/server/registry";
import { myBrand, myBrands, suggestions } from "@/server/sources-dto";
import { getSessionUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const [sources, suggested] = await Promise.all([myBrands(user.id), suggestions(user.id)]);
  return privateJson({ sources, suggestions: suggested });
}

/** Add Brand: validate → already following? → find/create shared source → subscribe → import if needed. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.slice(0, 500) : undefined;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.slice(0, 100) : undefined;
  if (!url && !sourceId) return privateJson({ error: "A website URL is required." }, { status: 400 });
  const res = await followSource(user.id, { url, sourceId, name: typeof body.name === "string" ? body.name : undefined });
  if (!res.ok) return privateJson({ error: res.error, subscriptionId: res.subscriptionId }, { status: res.status });
  // A source someone else already imported is reused as-is; only new sources start an import.
  if (res.needsSync) after(() => syncSource(res.source.id, "add").then(() => undefined));
  return privateJson({ source: await myBrand(user.id, res.source.id), next: res.source.ingestion_method === "manual" ? "manual" : res.needsSync ? "sync" : "ready" }, { status: 201 });
}
