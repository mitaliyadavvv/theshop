import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

/** token_hash links (works across browsers) — use if you customise the Supabase email templates. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"), type === "recovery" ? "/account/reset-password" : "/");
  if (token_hash && type) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      const dest = new URL(next, url.origin);
      if (type !== "recovery" && type !== "email_change") dest.searchParams.set("auth", "confirmed");
      return NextResponse.redirect(dest);
    }
  }
  const msg = "That link is invalid or has expired. Sign in below, or request a new confirmation email by signing up again with the same address.";
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));
}
