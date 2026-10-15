import type { ParsedSourceUrl } from "./url";

/** One registry entry per store, per collection, or per social profile. (No server-only import: scripts use it.) */
export function sourceKeyForParsed(p: Extract<ParsedSourceUrl, { ok: true }>, scope: "store" | "collection") {
  if (p.social) return `${p.social}:${p.canonical.toLowerCase().replace(/\/+$/, "")}`;
  return scope === "collection" && p.collectionHandle ? `${p.host}/collections/${p.collectionHandle}` : p.host;
}
