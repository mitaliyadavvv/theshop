import { privateJson, NO_STORE } from "@/server/http-response";
import { unfollow, updatePreferences } from "@/server/registry";
import { myBrand } from "@/server/sources-dto";
import { getSessionUser, unauthorized } from "@/server/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const s = await myBrand(user.id, (await params).id);
  return s ? privateJson({ source: s }) : privateJson({ error: "Not in your brands." }, { status: 404 });
}

/** User-level monitoring preferences only. Shared source settings aren't user-editable. */
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const s = await myBrand(user.id, (await params).id);
  if (!s?.subscriptionId) return privateJson({ error: "Not in your brands." }, { status: 404 });
  const prefs = typeof body.preferences === "object" && body.preferences ? body.preferences : {};
  const allowed = { notifyNewDrops: prefs.notifyNewDrops === true };
  const r = await updatePreferences(user.id, s.subscriptionId, allowed);
  return r ? privateJson({ preferences: r.preferences }) : privateJson({ error: "Not found" }, { status: 404 });
}

/** Remove from *my* collection. Shared catalogue and other users' subscriptions are untouched. */
export async function DELETE(_: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return (await unfollow(user.id, (await params).id))
    ? new Response(null, { status: 204, headers: NO_STORE })
    : privateJson({ error: "Not in your brands." }, { status: 404 });
}
