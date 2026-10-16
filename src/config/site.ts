/** Brand name is configuration, not code: set NEXT_PUBLIC_BRAND_NAME to rename the site. */
export const site = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "the shop.",
  tagline: "Every brand you love. Everything new. One place.",
  heroTitle: "Your brands. Their latest.",
  heroSub: "Every new drop, from every brand you love, in one\u00a0place.",   // no-break space: "place" never sits alone
};
