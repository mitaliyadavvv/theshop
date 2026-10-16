import { privateJson } from "@/server/http-response";
import { addManualProduct } from "@/server/registry";
import { getSessionUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Manually add a product link (social / unsupported sources). Private to the user who adds it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const price = b.price === "" || b.price == null ? null : Number(b.price);
  if (price != null && (!Number.isFinite(price) || price < 0 || price > 10_000_000)) return privateJson({ error: "Price must be a number." }, { status: 400 });
  const res = await addManualProduct(user.id, (await params).id, {
    url: String(b.url ?? "").slice(0, 1000), name: String(b.name ?? ""), imageUrl: b.imageUrl ? String(b.imageUrl).slice(0, 1000) : undefined,
    price, currency: b.currency ? String(b.currency).toUpperCase().slice(0, 3) : undefined,
    category: b.category ? String(b.category).slice(0, 30) : undefined,
  });
  return "error" in res ? privateJson({ error: res.error }, { status: 400 }) : privateJson(res, { status: 201 });
}
