export const DISPLAY_TZ = "Asia/Kolkata";

/** Start of "today" in the display timezone, as an absolute instant. */
export function startOfToday(now = new Date(), tz = DISPLAY_TZ): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(now).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "+00:00";
  return new Date(`${ymd}T00:00:00${off === "" ? "+00:00" : off}`);
}

export function dropCutoff(window: string, now = new Date()): Date {
  switch (window) {
    case "today": return startOfToday(now);
    case "week": return new Date(now.getTime() - 7 * 86400_000);
    case "month": return new Date(now.getTime() - 30 * 86400_000);
    default: return new Date(now.getTime() - 90 * 86400_000);
  }
}

export function formatDate(iso: string, opts: { withYear?: boolean } = {}) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: DISPLAY_TZ,
    ...(opts.withYear || !sameYear ? { year: "numeric" } : {}),
  });
}

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(iso, { withYear: true });
}

export const releasedLabel = (basis: string | null) =>
  basis === "published" ? "Published" : basis === "created" ? "Listed" : basis === "first_seen" ? "First seen" : null;
