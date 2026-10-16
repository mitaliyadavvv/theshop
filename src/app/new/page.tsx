import { NewDrops } from "@/components/NewDrops";
import { newDropDays } from "@/server/catalog";
import { dropsPageData } from "@/server/page-data";
import { parseCatalogQuery } from "@/server/query-params";
import { getViewer } from "@/server/auth";
import { dropCutoff } from "@/lib/dates";
import type { DropWindow } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "New drops" };

export default async function NewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  const parsed = parseCatalogQuery(await searchParams);
  const win: DropWindow = parsed.drop ?? "week";
  const query = { ...parsed, drop: win, sort: parsed.sort ?? ("newest" as const), page: 1 };
  const cutoffs = Object.fromEntries((["today", "week", "month", "recent"] as DropWindow[]).map((w) => [w, dropCutoff(w).toISOString()])) as Record<DropWindow, string>;
  const { initial, collections, categories, brands } = await dropsPageData(viewer, query);
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>New drops</h1>
        <p>
          {viewer ? "What your brands have released lately." : "What the preview brands have released lately."} Dates come from each
          store’s own publish date. Where a store doesn’t publish dates, we use the day we first spotted a product, and nothing from
          our first import of a brand ever counts as new.
        </p>
      </div>
      <NewDrops window={win} initial={initial} initialQuery={query} collections={collections}
        cutoffs={cutoffs} categories={categories} brands={brands} newDropDays={newDropDays()} />
    </div>
  );
}
