import { privateJson } from "@/server/http-response";
import { savedIds, setSaved } from "@/server/catalog";
import { getSessionUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return privateJson({ ids: await savedIds({ userId: user.id }) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const { productId, saved } = await req.json().catch(() => ({}));
  if (typeof productId !== "string" || productId.length > 200) return privateJson({ error: "productId required" }, { status: 400 });
  const r = await setSaved(user.id, productId, saved !== false);
  return r === "ok" ? privateJson({ ok: true })
    : r === "rate_limited" ? privateJson({ error: "Slow down a little." }, { status: 429 })
    : privateJson({ error: "Product not found" }, { status: 404 });
}
