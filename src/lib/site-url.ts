/**
 * Public origin used in auth emails (confirm sign-up, reset password).
 *
 * Use the configured production domain, not whatever host the user happens to be on:
 * Vercel's per-deployment URLs (the dashboard's "Visit" button) sit behind Deployment
 * Protection, so a link back to them shows Vercel's login page instead of the shop.
 * Falls back to the current origin when NEXT_PUBLIC_SITE_URL isn't set (local dev).
 */
export function authOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      const u = new URL(configured);
      if (u.protocol === "https:" || u.hostname === "localhost") return u.origin;
    } catch { /* fall through */ }
  }
  return typeof window !== "undefined" ? window.location.origin : "";
}
