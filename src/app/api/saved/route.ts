import { savedIds, setSaved } from "@/server/catalog";
import { getSessionUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return Response.json({ ids: await savedIds({ userId: user.id }) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { productId, saved } = await req.json().catch(() => ({}));
  if (typeof productId !== "string" || productId.length > 200) return Response.json({ error: "productId required" }, { status: 400 });
  const r = await setSaved(user.id, productId, saved !== false);
  return r === "ok" ? Response.json({ ok: true })
    : r === "rate_limited" ? Response.json({ error: "Slow down a little." }, { status: 429 })
    : Response.json({ error: "Product not found" }, { status: 404 });
}
