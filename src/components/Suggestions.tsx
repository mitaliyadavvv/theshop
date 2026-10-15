"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceDTO } from "@/lib/types";

/** One-click follow for registry brands the user doesn't follow yet. Nothing is added automatically. */
export function Suggestions({ items, title = "Brands you can follow" }: { items: SourceDTO[]; title?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const router = useRouter();
  if (!items.length) return null;
  const follow = async (id: string) => {
    setBusy(id); setError(null);
    const res = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: id }) });
    setBusy(null);
    if (res.ok || res.status === 409) { setDone((d) => new Set(d).add(id)); router.refresh(); }
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't follow that brand.");
  };
  return (
    <section aria-labelledby="suggest-title" style={{ marginTop: 32 }}>
      <h2 id="suggest-title" className="section-title" style={{ marginTop: 0 }}>{title}</h2>
      {error && <div className="notice notice--error" role="alert" style={{ marginTop: 12 }}><i />{error}</div>}
      <div className="suggest-grid">
        {items.map((s) => (
          <div key={s.id} className="suggest">
            <span className="brand-logo" aria-hidden>{s.logoUrl ? <img src={s.logoUrl} alt="" loading="lazy" /> : s.name.slice(0, 2).toUpperCase()}</span>
            <span style={{ minWidth: 0 }}>
              <span className="suggest__name">{s.name}</span>
              <span className="meta" style={{ display: "block" }}>{s.ingestionMethod === "manual" ? "Manual source" : `${s.productCount} products`}</span>
            </span>
            <button className="btn btn--sm" onClick={() => follow(s.id)} disabled={busy === s.id || done.has(s.id)}>
              {done.has(s.id) ? "Following" : busy === s.id ? "…" : "Follow"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
