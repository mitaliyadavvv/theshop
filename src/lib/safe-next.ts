/**
 * Validate a post-auth redirect target. Only same-site paths are allowed.
 * Resolving with URL() catches tricks a prefix check misses: browsers treat "\" as "/",
 * so "/\evil.example" would otherwise become the external "//evil.example".
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || /[\\\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const base = "https://same-site.invalid";
    const u = new URL(raw, base);
    return u.origin === base ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}
