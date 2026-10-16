import "server-only";
import { unstable_cache } from "next/cache";
import { withViewer, type Viewer } from "./db";
import { colourFromText, type ProductColour } from "@/lib/colour";

/** Garments only — the explorer is about clothing colour. */
const CLOTHING = ["tops", "bottoms", "dresses", "skirts", "coords", "jumpsuits", "outerwear"];
const MAX_ITEMS = 2500;

export type ColourItem = {
  id: string; name: string; brandName: string; imageUrl: string; url: string;
  price: number | null; currency: string | null; colour: ProductColour;
};

/**
 * Products visible to this viewer (their brands; or the public preview when signed out),
 * with a colour read from the name/tags. One query, only the columns the page needs.
 * Colour is pure string matching — cheap, deterministic, no image processing.
 */
async function load(viewer: Viewer): Promise<{ items: ColourItem[]; considered: number }> {
  const rows = await withViewer(viewer, (q) => q.query<{
    id: string; name: string; brand_name: string; image_url: string; url: string;
    price: number | null; currency: string | null; tags: string[];
  }>(
    `select p.id, p.name, b.name brand_name, p.image_url, p.url, p.price, p.currency, p.tags
       from products p join sources b on b.id = p.source_id
      where ${viewer ? "p.source_id in (select source_id from user_subscriptions)" : "b.public_preview"}
        and p.removed_at is null and not p.is_demo and p.image_url is not null
        and p.category = any($1::text[])
      order by p.id limit $2`, [CLOTHING, MAX_ITEMS]));
  const items: ColourItem[] = [];
  for (const r of rows) {
    const colour = colourFromText(r.name, r.tags ?? []);
    if (!colour) continue;
    items.push({ id: r.id, name: r.name, brandName: r.brand_name, imageUrl: r.image_url, url: r.url, price: r.price, currency: r.currency, colour });
  }
  return { items, considered: rows.length };
}

/** Signed-out preview only: identical for everyone, so cache it (no user data can be in it). */
const publicColours = unstable_cache(() => load(null), ["public-colours-v1"], { revalidate: 300, tags: ["public-catalog"] });

export const colourExplorerData = (viewer: Viewer) => (viewer ? load(viewer) : publicColours());
