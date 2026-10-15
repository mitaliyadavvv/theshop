/** Shown instead of the app when Supabase / the database aren't configured yet. */
export function SetupNotice() {
  const missing = [
    !process.env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    !process.env.DATABASE_URL && "DATABASE_URL",
  ].filter(Boolean);
  return (
    <div className="wrap auth-wrap">
      <div className="auth" style={{ maxWidth: 560 }}>
        <h1>Almost there</h1>
        <p className="muted">This deployment isn’t connected to its database yet. Add these environment variables, then redeploy:</p>
        <ul>{missing.map((m) => <li key={String(m)}><code>{m}</code></li>)}</ul>
        <p className="meta">See docs/DEPLOY.md in the repository for the full setup.</p>
      </div>
    </div>
  );
}
