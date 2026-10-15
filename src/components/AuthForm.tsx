"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "forgot" | "reset";

const COPY: Record<Mode, { title: string; cta: string; busy: string }> = {
  login: { title: "Sign in", cta: "Sign in", busy: "Signing in…" },
  signup: { title: "Create your account", cta: "Create account", busy: "Creating account…" },
  forgot: { title: "Reset your password", cta: "Send reset link", busy: "Sending…" },
  reset: { title: "Choose a new password", cta: "Update password", busy: "Updating…" },
};

/** Only allow same-site relative redirects after auth (no open redirects). */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "error" | "ok"; msg?: string }>({ kind: "idle" });
  const router = useRouter();
  const c = COPY[mode];
  const dest = safeNext(next);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "busy" });
    const supabase = supabaseBrowser();
    const origin = window.location.origin;
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(dest);
        router.refresh();
        return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(dest)}` },
        });
        if (error) throw error;
        if (data.session) { router.replace(dest); router.refresh(); return; }   // email confirmation disabled
        setState({ kind: "ok", msg: `Check ${email} for a confirmation link. Open it in this browser to finish signing up.` });
        return;
      }
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/account/reset-password")}`,
        });
        if (error) throw error;
        setState({ kind: "ok", msg: "If an account exists for that email, a reset link is on its way." });
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setState({ kind: "ok", msg: "Password updated." });
      setTimeout(() => { router.replace("/"); router.refresh(); }, 900);
    } catch (err) {
      const m = (err as { message?: string }).message ?? "Something went wrong.";
      setState({ kind: "error", msg: /invalid login/i.test(m) ? "Email or password is incorrect." : m });
    }
  }

  return (
    <div className="auth">
      <div className="auth__sq" aria-hidden><i style={{ background: "var(--orange)" }} /><i style={{ background: "var(--lime)" }} /><i style={{ background: "var(--lavender)" }} /></div>
      <h1>{c.title}</h1>
      {mode === "signup" && <p className="muted">Follow your favourite independent brands and keep their new drops in one place.</p>}
      {mode === "forgot" && <p className="muted">We’ll email you a link to set a new password.</p>}
      <form onSubmit={submit} className="auth__form">
        {mode !== "reset" && (
          <label className="field"><span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus /></label>
        )}
        {mode !== "forgot" && (
          <label className="field"><span>{mode === "reset" ? "New password" : "Password"}</span>
            <input className="input" type="password" required minLength={mode === "login" ? 1 : 8}
              autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode !== "login" && <span className="meta">At least 8 characters.</span>}</label>
        )}
        <button className="btn btn--solid auth__cta" disabled={state.kind === "busy"}>{state.kind === "busy" ? c.busy : c.cta}</button>
      </form>
      <div aria-live="polite">
        {state.kind === "error" && <div className="notice notice--error" role="alert"><i />{state.msg}</div>}
        {state.kind === "ok" && <div className="notice"><i style={{ background: "#8fc93a" }} />{state.msg}</div>}
      </div>
      <p className="auth__alt meta">
        {mode === "login" && <><Link className="link" href={`/signup${next ? `?next=${encodeURIComponent(dest)}` : ""}`}>Create an account</Link> · <Link className="link" href="/forgot-password">Forgot password?</Link></>}
        {mode === "signup" && <>Already have an account? <Link className="link" href={`/login${next ? `?next=${encodeURIComponent(dest)}` : ""}`}>Sign in</Link></>}
        {mode === "forgot" && <Link className="link" href="/login">Back to sign in</Link>}
      </p>
    </div>
  );
}
