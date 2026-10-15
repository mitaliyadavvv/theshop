import type { CategoryId } from "@/lib/categories";
import { categoryLabel } from "@/lib/categories";

const w = (s: string) => new RegExp(`\\b(?:${s})\\b`, "i");

/**
 * Keyword rules, most specific first. "Co-ord" beats "top" (a "top & pant set"
 * is a set), "dress" beats "shirt" ("shirt dress"), and so on.
 */
const RULES: [CategoryId, RegExp][] = [
  ["bags", w("bags?|totes?|clutch(?:es)?|pouch(?:es)?|purses?|backpacks?|wallets?|potli")],
  ["coords", w("co-?ords?|co-?ordinates?|co-?ord ?sets?|cord ?sets?|two[- ]piece|2[- ]piece|matching sets?|kurta sets?|suit sets?|(?:top|kurta|kurti|shirt|blouse)s? (?:and|&|with) [\\w ]*(?:salwar|pants?|trousers?|skirts?|shorts|palazzos?|sharara|dupatta)")],
  ["jumpsuits", w("jumpsuits?|playsuits?|rompers?|dungarees?|overalls?|boiler ?suits?")],
  ["dresses", w("dress(?:es)?|gowns?|sundress|kaftans?|anarkali")],
  ["skirts", w("skirts?|skorts?|lehenga")],
  ["jewellery", w("jewell?e?ry|earrings?|ear ?cuffs?|studs|hoops|necklaces?|pendants?|chokers?|bracelets?|bangles?|anklets?|rings?|charms?|brooch(?:es)?|chains?")],
  ["footwear", w("shoes?|sandals?|heels?|sneakers?|mules?|loafers?|boots?|slides?|flip ?flops?|juttis?|kolhapuris?|footwear")],
  ["bottoms", w("trousers?|pants?|jeans?|shorts|culottes?|palazzos?|joggers?|leggings?|cargos?|bottoms?|salwar|pyjamas?|pajamas?|flares?")],
  ["outerwear", w("jackets?|blazers?|coats?|trench(?:coats?)?|robes?|shrugs?|cardigans?|hoodies?|sweatshirts?|sweaters?|pullovers?|jumpers?|kimonos?|overshirts?|shackets?|waistcoats?|outerwear|knitwear")],
  ["tops", w("tops?|shirts?|tees?|t-?shirts?|blouses?|tanks?|tank tops?|camis?|camisoles?|crop(?:ped)?|corsets?|bodysuits?|tunics?|kurtas?|kurtis?|halters?|tube tops?|vests?|polos?|bralettes?|bustiers?")],
  ["accessories", w("scarf|scarves|stoles?|dupattas?|belts?|hair ?clips?|claw clips?|scrunchies?|hairbands?|headbands?|bandanas?|caps?|hats?|beanies?|sunglasses|socks|keychains?|bag charms?|accessor(?:y|ies)|bows?|gloves?|ties?|masks?")],
];

const GENERIC_SET = /\bsets?\b(?!\s+of)/i;

const EXCLUDE = w("gift ?cards?|e-?gift|shipping protection|route protection|insurance|donation|test product");

export function isExcludedProduct(name: string, productType: string | null) {
  return EXCLUDE.test(name) || (productType != null && EXCLUDE.test(productType));
}

/**
 * Category from real product information only, in priority order:
 * the source's own product type, then its tags, then the product name.
 */
export function inferCategory(input: { productType: string | null; tags: string[]; name: string }): {
  category: CategoryId; basis: "product_type" | "tags" | "title" | "none";
} {
  const tryText = (text: string): CategoryId | null => {
    for (const [cat, re] of RULES) if (re.test(text)) return cat;
    // A bare "set" ("Mehfil Set") is a co-ord, but "set of 3 scrunchies" is not.
    if (GENERIC_SET.test(text)) return "coords";
    return null;
  };
  if (input.productType) {
    const c = tryText(input.productType);
    if (c) return { category: c, basis: "product_type" };
  }
  // Title before tags: tags are often merchandising buckets ("Tops", "Bestsellers")
  // applied across many items, while the title names the actual garment.
  const t = tryText(input.name);
  if (t) return { category: t, basis: "title" };
  // Tags: count votes so a single stray tag doesn't win.
  const votes = new Map<CategoryId, number>();
  for (const tag of input.tags) {
    const c = tryText(tag);
    if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return { category: best[0], basis: "tags" };
  return { category: "other", basis: "none" };
}

export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, "–").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return text ? text.slice(0, 2000) : null;
}

export function decodeEntities(s: string) {
  return stripHtml(s) ?? s;
}

export const toNumber = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const toIso = (v: unknown): string | null => {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const REPUBLISH_GAP_DAYS = 30;

/**
 * Pick the date that represents when a product was released, without
 * mistaking a re-publish (or our own import) for a launch:
 *  - Source publish date, unless the product record is much older than its
 *    publish date — then the store re-published an old item, so use creation.
 *  - First-seen date only for products discovered after a source's baseline
 *    import (anything in the first import is "already existed", not new).
 */
export function releaseDate(p: { sourcePublishedAt: string | null; sourceCreatedAt: string | null }, firstSeenAt: string, afterBaseline: boolean):
  { releasedAt: string | null; basis: "published" | "created" | "first_seen" | null } {
  const pub = p.sourcePublishedAt, created = p.sourceCreatedAt;
  if (pub && created && Date.parse(pub) - Date.parse(created) > REPUBLISH_GAP_DAYS * 86400_000) {
    return { releasedAt: created, basis: "created" };
  }
  if (pub) return { releasedAt: pub, basis: "published" };
  if (created) return { releasedAt: created, basis: "created" };
  if (afterBaseline) return { releasedAt: firstSeenAt, basis: "first_seen" };
  return { releasedAt: null, basis: null };
}

export function searchDocument(p: { name: string; description: string | null; tags: string[]; category: string; sourceCategory: string | null }, brand: string) {
  return {
    name: p.name,
    brand,
    category: `${categoryLabel(p.category)} ${p.sourceCategory ?? ""}`.trim(),
    tags: p.tags.join(" "),
    description: p.description ?? "",
  };
}
