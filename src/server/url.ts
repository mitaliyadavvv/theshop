const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|igshid$|igsh$|mc_|_ga$|ref$|ref_src$|srsltid$|si$)/i;

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "tiktok.com": "tiktok",
  "pinterest.com": "pinterest",
  "x.com": "x",
  "twitter.com": "x",
};

export type ParsedSourceUrl = {
  ok: true;
  original: string;
  canonical: string;      // https, no tracking params, no trailing slash noise
  origin: string;         // https://host
  host: string;           // host without www.
  social: string | null;  // instagram, etc.
  collectionHandle: string | null;
} | { ok: false; error: string };

export function parseSourceUrl(input: string): ParsedSourceUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a URL." };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "Only http(s) URLs are supported." };
  if (!u.hostname.includes(".") || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(u.hostname)) {
    return { ok: false, error: "Use a public website address." };
  }
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
  u.hash = "";
  u.protocol = "https:";
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const social = SOCIAL_HOSTS[host] ?? null;
  const m = u.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/([^/?#]+)/i);
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const canonical = `${u.origin}${path === "/" ? "/" : path}${u.search}`;
  return {
    ok: true,
    original: raw,
    canonical,
    origin: u.origin,
    host,
    social,
    collectionHandle: m && m[1] !== "all" ? decodeURIComponent(m[1]).toLowerCase() : null,
  };
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 48) || "source";
}
