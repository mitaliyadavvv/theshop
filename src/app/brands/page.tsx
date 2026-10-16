import { redirect } from "next/navigation";
import { BrandsManager } from "@/components/BrandsManager";
import { myBrands, suggestions } from "@/server/sources-dto";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "My brands" };

export default async function BrandsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/brands");
  const [mine, suggested] = await Promise.all([myBrands(user.id), suggestions(user.id)]);
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>My brands</h1>
        <p>The brands in your collection. Only you can see this list. Each one syncs daily. Nothing here is guessed: if a brand can’t be read automatically, it says so.</p>
      </div>
      <BrandsManager initial={mine} suggested={suggested} />
    </div>
  );
}
