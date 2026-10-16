import { ColourExplorer } from "@/components/ColourExplorer";
import { colourExplorerData } from "@/server/colour-data";
import { getViewer } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Colour Explorer" };

export default async function ColoursPage() {
  const viewer = await getViewer();
  const { items, considered } = await colourExplorerData(viewer);
  return (
    <div className="wrap" style={{ paddingBottom: 96 }}>
      <div className="page-head">
        <h1>Colour Explorer</h1>
        <p>
          {viewer ? "Your brands" : "The preview brands"}, arranged by shade — the spectrum runs across, light to dark runs down.
          Hover a piece to see it; click to open it on the brand’s own site.
        </p>
      </div>
      <ColourExplorer items={items} considered={considered} signedIn={!!viewer} />
    </div>
  );
}
