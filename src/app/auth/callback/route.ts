import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** PKCE: email confirmation & password-reset links land here with ?code=… */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const raw = url.searchParams.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const msg = url.searchParams.get("error_description") ?? "That link is invalid or has expired. Please try again.";
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));
}
