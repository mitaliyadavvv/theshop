/**
 * Soft brand mixing for a ranked feed. A preference, not a rule:
 *
 * 1. Spread: each item's key blends its place in the base ranking (recency / relevance)
 *    with its place within its own brand, so each brand's products are distributed across
 *    the feed in proportion to how many it has. One brand → keys equal the base order.
 * 2. Run-breaking: where two neighbours share a brand, pull forward the nearest different
 *    brand within a short window. If none is near (e.g. only one brand left), the run stays —
 *    nothing is ever dropped, hidden or duplicated.
 *
 * Deterministic and computed over the whole ranked list, so pagination is a stable slice.
 */
export type Ranked = { id: string; brand: string };

export function diversify<T extends Ranked>(ranked: T[], opts: { weight?: number; window?: number } = {}): T[] {
  const n = ranked.length;
  const brandTotals = new Map<string, number>();
  for (const r of ranked) brandTotals.set(r.brand, (brandTotals.get(r.brand) ?? 0) + 1);
  if (brandTotals.size < 2) return ranked.slice();               // nothing to mix

  const weight = opts.weight ?? 0.5;                              // share of the key that is base rank
  const window = opts.window ?? 8;
  const seen = new Map<string, number>();
  const keyed = ranked.map((r, g) => {
    const b = seen.get(r.brand) ?? 0;
    seen.set(r.brand, b + 1);
    const key = weight * ((g + 0.5) / n) + (1 - weight) * ((b + 0.5) / brandTotals.get(r.brand)!);
    return { r, g, key };
  });
  keyed.sort((a, b) => a.key - b.key || a.g - b.g);
  const out = keyed.map((k) => k.r);

  for (let i = 1; i < out.length; i++) {
    if (out[i].brand !== out[i - 1].brand) continue;
    const limit = Math.min(out.length, i + 1 + window);
    for (let j = i + 1; j < limit; j++) {
      if (out[j].brand !== out[i - 1].brand) {
        const [pick] = out.splice(j, 1);
        out.splice(i, 0, pick);
        break;
      }
    }
  }
  return out;
}

/** Longest stretch of one brand in a row (used in tests / diagnostics). */
export function longestRun(list: Ranked[]): number {
  let best = 0, cur = 0;
  list.forEach((r, i) => { cur = i && r.brand === list[i - 1].brand ? cur + 1 : 1; best = Math.max(best, cur); });
  return best;
}
