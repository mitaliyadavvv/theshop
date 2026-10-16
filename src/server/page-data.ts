import "server-only";
import { unstable_cache } from "next/cache";
import { withViewer, type Viewer } from "./db";
import {
  brandOptionsAs, categoryOptionsAs, heroProductsAs, heroStatsAs, recentCollectionsAs, searchCatalogAs,
} from "./catalog";
import type { CatalogQuery } from "@/lib/types";

/**
 * Everything a page needs, in ONE transaction with the queries sent together.
 * (Previously each helper opened its own transaction: ~28 sequential DB round trips per
 * home page, which is seconds when the server is far from the database.)
 */
async function homeBundle(viewer: Viewer, query: CatalogQuery) {
  return withViewer(viewer, async (q) => {
    const [initial, stats, photos, categories, brands] = await Promise.all([
      searchCatalogAs(q, viewer, query), heroStatsAs(q, viewer), heroProductsAs(q, viewer, 6),
      categoryOptionsAs(q, viewer), brandOptionsAs(q, viewer),
    ]);
    return { initial, stats, photos, categories, brands };
  });
}

async function dropsBundle(viewer: Viewer, query: CatalogQuery) {
  return withViewer(viewer, async (q) => {
    const [initial, collections, categories, brands] = await Promise.all([
      searchCatalogAs(q, viewer, query), recentCollectionsAs(q, viewer, "recent", 40),
      categoryOptionsAs(q, viewer), brandOptionsAs(q, viewer),
    ]);
    return { initial, collections, categories, brands };
  });
}

/**
 * Signed-out visitors all see the same public preview, so cache it on the server for a few
 * minutes. Only ever called with viewer = null: no user id, cookie or private row can be in
 * these results (and RLS for `anon` excludes private data anyway). Signed-in pages are never cached.
 */
const PUBLIC_TTL_SECONDS = 300;
// Bump the -vN keys whenever the shape or ORDER of these results changes (v2: brand mixing),
// so a deploy never serves entries computed by the previous version.
const publicHome = unstable_cache((queryKey: string) => homeBundle(null, JSON.parse(queryKey)),
  ["public-home-v2"], { revalidate: PUBLIC_TTL_SECONDS, tags: ["public-catalog"] });
const publicDrops = unstable_cache((queryKey: string) => dropsBundle(null, JSON.parse(queryKey)),
  ["public-drops-v2"], { revalidate: PUBLIC_TTL_SECONDS, tags: ["public-catalog"] });

/** Stable cache key: the same filters in any order hit the same entry. */
const keyOf = (query: CatalogQuery) => JSON.stringify(query, Object.keys(query).sort());

export const homePageData = (viewer: Viewer, query: CatalogQuery) =>
  viewer ? homeBundle(viewer, query) : publicHome(keyOf(query));

export const dropsPageData = (viewer: Viewer, query: CatalogQuery) =>
  viewer ? dropsBundle(viewer, query) : publicDrops(keyOf(query));

export const savedPageData = (viewer: NonNullable<Viewer>, query: CatalogQuery) =>
  withViewer(viewer, async (q) => {
    const [initial, categories, brands] = await Promise.all([
      searchCatalogAs(q, viewer, query), categoryOptionsAs(q, viewer), brandOptionsAs(q, viewer),
    ]);
    return { initial, categories, brands };
  });

/** Public product API for signed-out visitors (same cache rules as above). */
export const publicSearch = unstable_cache((queryKey: string) => withViewer(null, (q) => searchCatalogAs(q, null, JSON.parse(queryKey))),
  ["public-search-v2"], { revalidate: PUBLIC_TTL_SECONDS, tags: ["public-catalog"] });
export { keyOf as catalogCacheKey };
