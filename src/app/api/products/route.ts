import { searchCatalog } from "@/server/catalog";
import { catalogCacheKey, publicSearch } from "@/server/page-data";
import { parseCatalogQuery } from "@/server/query-params";
import { getViewer } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Signed in: the user's own brands. Signed out: a read-only preview. */
export async function GET(req: Request) {
  try {
    const viewer = await getViewer();
    const query = parseCatalogQuery(new URL(req.url).searchParams);
    // Server-side cache for the anonymous preview only. No CDN caching: responses depend on the session cookie.
    const data = viewer ? await searchCatalog(viewer, query) : await publicSearch(catalogCacheKey(query));
    return Response.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    console.error("[api/products]", e);
    return Response.json({ error: "Couldn't load products." }, { status: 500 });
  }
}
