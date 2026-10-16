import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

/** PKCE: email confirmation & password-reset links land here with ?code=… */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(withConfirmedFlag(next, url.origin));
  }
  const msg = url.searchParams.get("error_description")
    ?? "That link is invalid or has expired, or was opened in a different browser from the one you signed up in. Sign in below, or request a new link.";
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));
}

/** After a sign-up confirmation, tell the user it worked (not for password-reset links). */
function withConfirmedFlag(next: string, origin: string) {
  const u = new URL(next, origin);
  if (!u.pathname.startsWith("/account/reset-password")) u.searchParams.set("auth", "confirmed");
  return u;
}
