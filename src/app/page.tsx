import Link from "next/link";
import { Hero } from "@/components/Hero";
import { Catalogue } from "@/components/Catalogue";
import { Suggestions } from "@/components/Suggestions";
import { AddBrandForm } from "@/components/AddBrandForm";
import { brandOptions, categoryOptions, heroProducts, heroStats, newDropDays, searchCatalog } from "@/server/catalog";
import { parseCatalogQuery } from "@/server/query-params";
import { getViewer } from "@/server/auth";
import { suggestions } from "@/server/sources-dto";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  const query = parseCatalogQuery(await searchParams);
  query.page = 1;
  const [initial, stats, photos, categories, brands] = await Promise.all([
    searchCatalog(viewer, query), heroStats(viewer), heroProducts(viewer, 6), categoryOptions(viewer), brandOptions(viewer),
  ]);
  const noBrands = !!viewer && stats.brands === 0;
  return (
    <>
      <Hero photos={photos} stats={stats} />
      <section id="catalogue" className="catalogue wrap" aria-label="Catalogue">
        {!viewer && (
          <div className="preview-banner" style={{ marginTop: 0, marginBottom: 32 }}>
            <span><i />You’re previewing a few independent brands. Create a free account to follow your own, and save favourites.</span>
            <span style={{ display: "flex", gap: 8 }}><Link className="btn btn--sm btn--solid" href="/signup">Create account</Link><Link className="btn btn--sm" href="/login">Sign in</Link></span>
          </div>
        )}
        {noBrands ? (
          <div>
            <h2 className="lookfor">Start your collection</h2>
            <p className="muted" style={{ marginTop: 12, maxWidth: "56ch" }}>
              Add the brands you follow — paste a website, a collection link or an Instagram profile — or pick from brands already here. Only you can see your collection.
            </p>
            <div style={{ marginTop: 24 }}><AddBrandForm /></div>
            <Suggestions items={await suggestions(viewer!.userId)} />
          </div>
        ) : (
          <Catalogue key={JSON.stringify(query)} heading="lookfor" initial={initial} initialQuery={query}
            categories={categories} brands={brands} newDropDays={newDropDays()} />
        )}
        {!viewer && initial.total > initial.items.length && (
          <p className="meta" style={{ textAlign: "center", marginTop: 32 }}>
            Previews show the first {initial.pageSize * 2} matches. <Link className="link" href="/signup">Create an account</Link> to see everything.
          </p>
        )}
      </section>
    </>
  );
}
