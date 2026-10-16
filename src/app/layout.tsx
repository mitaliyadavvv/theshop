import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { cookies } from "next/headers";
import { preconnect } from "react-dom";
import "./globals.css";
import { site } from "@/config/site";
import { Header } from "@/components/Header";
import { SavedProvider } from "@/components/SavedProvider";
import { SetupNotice } from "@/components/SetupNotice";
import { AuthNotice } from "@/components/AuthNotice";
import { Suspense } from "react";
import { getSessionUser } from "@/server/auth";
import { savedIds } from "@/server/catalog";
import { supabaseConfigured } from "@/lib/supabase/env";

const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name}` },
  description: "A personal discovery layer for the independent fashion brands you follow.",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#F7F6F2" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  preconnect("https://cdn.shopify.com");   // most product images are served from Shopify's CDN
  const configured = supabaseConfigured && !!process.env.DATABASE_URL;
  const user = configured ? await getSessionUser() : null;
  const saved = user ? await savedIds({ userId: user.id }) : [];
  // The hero entrance plays once per browser session (session cookie set by <Hero>).
  const heroPlayed = (await cookies()).has("hero_played");
  return (
    <html lang="en-IN" className={manrope.variable} data-hero-played={heroPlayed ? "" : undefined}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <SavedProvider key={user?.id ?? "anon"} initial={saved} signedIn={!!user}>
          <Header user={user ? { email: user.email } : null} />
          <Suspense fallback={null}><AuthNotice signedIn={!!user} /></Suspense>
          <main id="main">{configured ? children : <SetupNotice />}</main>
        </SavedProvider>
        <footer className="footer">
          <div className="wrap">
            <span>{site.name} — a personal discovery layer. Nothing is sold here; every product links to the brand’s own site.</span>
            <span>Prices and stock come from each brand and can change.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
