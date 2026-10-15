"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceDTO } from "@/lib/types";

type State =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string }
  | { phase: "tracking"; source: SourceDTO; next: "sync" | "manual" | "ready" };

const FINAL = new Set(["ok", "partial", "error", "unsupported", "manual"]);

export function describeOutcome(s: SourceDTO): { tone: "ok" | "warn" | "info"; text: string } {
  if (s.status === "ok") return { tone: "ok", text: `Connected via ${s.platform === "woocommerce" ? "WooCommerce" : "Shopify"}. Imported ${s.productCount} products.` };
  if (s.status === "partial") return { tone: "warn", text: `Partly imported (${s.productCount} products). ${s.statusDetail ?? ""}` };
  if (s.status === "manual") return { tone: "info", text: s.statusDetail ?? "Saved as a manual source. Add products from the Brands page." };
  if (s.status === "unsupported") return { tone: "warn", text: `Saved, but needs setup: ${s.statusDetail}` };
  if (s.status === "error") return { tone: "warn", text: `Saved, but the import failed: ${s.statusDetail}. You can retry from the Brands page.` };
  return { tone: "info", text: "Saved. Looking for a product feed and importing…" };
}

/** Add a brand by URL: persists the source, then follows the real import status until it settles. */
export function AddBrandForm({ onDone, compact = false }: { onDone?: (s: SourceDTO) => void; compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const track = (id: string, tries = 0) => {
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sources/${id}`);
        const { source } = (await res.json()) as { source: SourceDTO };
        setState((st) => (st.phase === "tracking" ? { ...st, source } : st));
        if (FINAL.has(source.status) && !source.syncing) { router.refresh(); onDone?.(source); return; }
      } catch { /* keep polling */ }
      if (tries < 90) track(id, tries + 1);
    }, 2000);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ phase: "submitting" });
    try {
      const res = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, name: name || undefined }) });
      const body = await res.json();
      if (res.status === 401) { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`; return; }
      if (!res.ok) { setState({ phase: "error", message: body.error ?? "Couldn't add that brand." }); return; }
      setState({ phase: "tracking", source: body.source, next: body.next });
      setUrl(""); setName("");
      router.refresh();
      if (body.next === "sync" || body.source?.syncing) track(body.source.id); else onDone?.(body.source);
    } catch {
      setState({ phase: "error", message: "Network error — the brand wasn't added." });
    }
  }

  const outcome = state.phase === "tracking" ? describeOutcome(state.source) : null;
  return (
    <div>
      <form className="add-form" onSubmit={submit} style={compact ? { gridTemplateColumns: "1fr" } : undefined}>
        <label className="field">
          <span>Website, collection or Instagram URL</span>
          <input className="input" data-autofocus required inputMode="url" placeholder="brand.com or brand.com/collections/new"
            value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input className="input" placeholder="Detected from the URL" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn btn--solid" style={{ height: 40 }} disabled={state.phase === "submitting" || !url.trim()}>
          {state.phase === "submitting" ? "Adding…" : "Add brand"}
        </button>
      </form>
      <div className="add-result" aria-live="polite">
        {state.phase === "error" && <div className="notice notice--error"><i />{state.message}</div>}
        {state.phase === "tracking" && outcome && (
          <div className={`notice${outcome.tone === "warn" ? " notice--error" : ""}`}>
            <i style={outcome.tone === "ok" ? { background: "#8fc93a" } : undefined} />
            <span><strong style={{ color: "var(--ink)", fontWeight: 500 }}>{state.source.name}</strong> — {outcome.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
