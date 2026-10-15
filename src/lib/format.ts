export function formatPrice(amount: number | null, currency: string | null) {
  if (amount == null) return null;
  if (!currency) return amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-IN")}`;
  }
}

/** Ask Shopify's CDN for a right-sized image; other hosts get the original URL. */
export function imageAt(url: string | null, width: number) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url);
    if (u.hostname === "cdn.shopify.com" || u.pathname.includes("/cdn/shop/")) {
      u.searchParams.set("width", String(width));
      return u.toString();
    }
    return u.toString();
  } catch {
    return url;
  }
}
