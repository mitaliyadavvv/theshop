import { redirect } from "next/navigation";
import { Catalogue } from "@/components/Catalogue";
import { newDropDays } from "@/server/catalog";
import { savedPageData } from "@/server/page-data";
import { parseCatalogQuery } from "@/server/query-params";
import { getViewer } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved" };

export default async function SavedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/saved");
  const query = { ...parseCatalogQuery(await searchParams), savedOnly: true, page: 1 };
  const { initial, categories, brands } = await savedPageData(viewer, query);
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Saved</h1>
        <p>Things you’ve kept an eye on. Only you can see this list. Saved items stay here even if a brand stops listing them.</p>
      </div>
      <Catalogue key={JSON.stringify(query)} initial={initial} initialQuery={query} fixed={{ savedOnly: true }}
        categories={categories} brands={brands} newDropDays={newDropDays()}
        emptyHint="Tap the heart on any product to save it here." />
    </div>
  );
}
