import { searchCatalog } from "@/server/catalog";
import { parseCatalogQuery } from "@/server/query-params";
import { getViewer } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Signed in: the user's own brands. Signed out: a read-only preview. */
export async function GET(req: Request) {
  try {
    return Response.json(await searchCatalog(await getViewer(), parseCatalogQuery(new URL(req.url).searchParams)));
  } catch (e) {
    console.error("[api/products]", e);
    return Response.json({ error: "Couldn't load products." }, { status: 500 });
  }
}
