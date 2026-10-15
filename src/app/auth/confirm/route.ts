import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

/** token_hash links (works across browsers) — use if you customise the Supabase email templates. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const raw = url.searchParams.get("next") ?? (type === "recovery" ? "/account/reset-password" : "/");
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  if (token_hash && type) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("That link is invalid or has expired.")}`, url.origin));
}
