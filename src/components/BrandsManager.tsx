"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AddBrandForm } from "./AddBrandForm";
import { Suggestions } from "./Suggestions";
import { ArrowUpRight, RefreshIcon } from "./icons";
import { CATEGORIES } from "@/lib/categories";
import { formatDate, timeAgo } from "@/lib/dates";
import type { SourceDTO } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  ok: "Connected", partial: "Partly imported", error: "Sync failed", manual: "Manual source",
  unsupported: "Needs setup", pending: "Not synced yet", syncing: "Syncing…",
};
const METHOD_LABEL: Record<string, string> = {
  shopify_products_json: "Shopify public product feed (/products.json)",
  woocommerce_store_api: "WooCommerce Store API (/wp-json/wc/store/v1)",
  manual: "Manual — products added by you",
};

function Monogram({ s }: { s: SourceDTO }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="brand-logo" aria-hidden>
      {s.logoUrl && !broken ? <img src={s.logoUrl} alt="" onError={() => setBroken(true)} loading="lazy" /> : s.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ManualProductForm({ source, onAdded }: { source: SourceDTO; onAdded: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = Object.fromEntries(new FormData(form));
    setBusy(true);
    const res = await fetch(`/api/sources/${source.id}/products`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fd) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { form.reset(); setMsg({ ok: true, text: "Added to the catalogue." }); onAdded(); }
    else setMsg({ ok: false, text: body.error ?? "Couldn't add that product." });
  }
  return (
    <form onSubmit={submit} className="manual-form">
      <label className="field"><span>Product link *</span><input name="url" className="input" required placeholder="https://…" /></label>
      <label className="field"><span>Name *</span><input name="name" className="input" required /></label>
      <label className="field"><span>Image URL</span><input name="imageUrl" className="input" placeholder="optional" /></label>
      <label className="field"><span>Price (₹)</span><input name="price" className="input" inputMode="decimal" placeholder="optional" /></label>
      <label className="field"><span>Category</span>
        <select name="category" className="input" defaultValue=""><option value="">Detect from name</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <button className="btn btn--solid" style={{ height: 40 }} disabled={busy}>{busy ? "Adding…" : "Add product"}</button>
      {msg && <p className="meta" role="status" style={{ gridColumn: "1 / -1", color: msg.ok ? undefined : "var(--orange)" }}>{msg.text}</p>}
    </form>
  );
}

function BrandRow({ s, onChange }: { s: SourceDTO; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const status = s.syncing ? "syncing" : s.status;
  const canSync = s.ingestionMethod !== "manual";

  const sync = async () => {
    setBusy(true); setNote(null);
    const res = await fetch(`/api/sources/${s.id}/sync`, { method: "POST" });
    if (!res.ok) setNote((await res.json().catch(() => ({}))).error ?? "Couldn't start a refresh.");
    setBusy(false);
    onChange();
  };
  const [note, setNote] = useState<string | null>(null);
  const remove = async () => {
    if (!confirm(`Remove ${s.name} from your brands? Its products leave your catalogue; nobody else is affected.`)) return;
    await fetch(`/api/sources/${s.id}`, { method: "DELETE" });
    onChange(); router.refresh();
  };

  const lastRun = s.runs[0];
  return (
    <li className="brand-row">
      <div className="brand-row__main">
        <Monogram s={s} />
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">{s.name}</div>
          <a className="brand-url link" href={s.canonicalUrl ?? s.originalUrl} target="_blank" rel="noopener noreferrer">
            {(s.canonicalUrl ?? s.originalUrl).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        </div>
        <div>
          <span className="status" data-s={status}><i />{STATUS_LABEL[status] ?? status}</span>
          {s.statusDetail && (status === "error" || status === "unsupported" || status === "partial") && (
            <div className="meta" style={{ marginTop: 2 }}>{s.statusDetail.length > 90 ? s.statusDetail.slice(0, 90) + "…" : s.statusDetail}</div>
          )}
        </div>
        <div className="meta"><span className="count-num">{s.productCount.toLocaleString("en-IN")}</span> products</div>
        <div className="meta">{s.lastSuccessfulSync ? <>Synced {timeAgo(s.lastSuccessfulSync)}</> : canSync ? "Never synced" : "—"}</div>
        <div className="brand-actions">
          {canSync && (
            <button className="btn btn--sm btn--ghost" onClick={sync} disabled={busy || s.syncing} aria-label={`${s.status === "error" || s.status === "unsupported" ? "Retry" : "Refresh"} ${s.name}`}>
              <RefreshIcon width={12} height={12} />{s.status === "error" || s.status === "unsupported" ? "Retry" : "Refresh"}
            </button>
          )}
          <button className="btn btn--sm btn--ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : s.ingestionMethod === "manual" ? "Add products" : status === "error" || status === "unsupported" ? "View errors" : "Details"}
          </button>
          <a className="icon-btn" href={s.canonicalUrl ?? s.originalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.name} website`}><ArrowUpRight /></a>
        </div>
      </div>
      {note && <p className="meta" role="status" style={{ padding: "0 0 12px 60px", color: "var(--orange)" }}>{note}</p>}
      {open && (
        <div className="brand-detail">
          <dl>
            <dt>Source type</dt><dd>{s.sourceType === "social" ? `Social profile (${s.platform})` : s.sourceType === "collection" ? "Collection page" : "Website"}</dd>
            <dt>Ingestion</dt><dd>{s.ingestionMethod ? METHOD_LABEL[s.ingestionMethod] ?? s.ingestionMethod : "Not identified yet"}{s.platform && s.platform !== "instagram" ? ` · ${s.platform}` : ""}</dd>
            <dt>Verified</dt><dd>{s.verified ? "Yes — products imported successfully" : "No"}</dd>
            <dt>Original URL</dt><dd>{s.originalUrl}</dd>
            {s.canonicalUrl && s.canonicalUrl !== s.originalUrl && <><dt>Canonical URL</dt><dd>{s.canonicalUrl}</dd></>}
            {s.collectionHandle && (
              <><dt>Scope</dt><dd>
                The <strong>{s.collectionHandle}</strong> collection{s.statusDetail?.includes("full store catalogue") ? " (currently importing the full store — see status note)" : ""}.
                To follow the whole store instead, add <span className="meta">{s.host}</span> as a brand.
              </dd></>
            )}
            {s.addedAt && <><dt>Added</dt><dd>{formatDate(s.addedAt, { withYear: true })}</dd></>}
            <dt>Last attempt</dt><dd>{s.lastAttemptedSync ? `${formatDate(s.lastAttemptedSync)} · ${timeAgo(s.lastAttemptedSync)}` : "—"}</dd>
            <dt>Last success</dt><dd>{s.lastSuccessfulSync ? `${formatDate(s.lastSuccessfulSync)} · ${timeAgo(s.lastSuccessfulSync)}` : "—"}</dd>
            {s.statusDetail && <><dt>Status note</dt><dd>{s.statusDetail}</dd></>}
            {s.notes && <><dt>Assessment</dt><dd className="muted">{s.notes}</dd></>}
          </dl>
          {s.ingestionMethod === "manual" || s.status === "unsupported" ? (
            <div>
              <p className="meta" style={{ marginBottom: 8 }}>
                {s.sourceType === "social"
                  ? "Instagram isn’t scraped. Paste product links from their posts or bio (e.g. a DM-to-order post or a linked store page)."
                  : "No automated feed was found. You can add individual products by hand."}
              </p>
              <ManualProductForm source={s} onAdded={onChange} />
            </div>
          ) : null}
          {s.runs.length > 0 && (
            <table className="runs">
              <caption className="sr-only">Recent syncs</caption>
              <thead><tr><th>When</th><th>Trigger</th><th>Result</th><th>Products</th><th>Notes</th></tr></thead>
              <tbody>
                {s.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{timeAgo(r.startedAt)}</td><td>{r.trigger}</td>
                    <td><span className="status" data-s={r.status === "running" ? "syncing" : r.status}><i />{r.status}</span></td>
                    <td>{r.status === "error" ? "—" : `${r.seen} (${r.created} new${r.removed ? `, ${r.removed} gone` : ""})`}</td>
                    <td>{r.error ?? r.warnings.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lastRun?.status === "error" && s.productCount > 0 && (
            <p className="meta">Previously imported products are still in the catalogue; a failed sync never deletes them.</p>
          )}
          <div><button className="btn btn--sm btn--danger" onClick={remove}>Remove from my brands</button></div>
        </div>
      )}
    </li>
  );
}

export function BrandsManager({ initial, suggested }: { initial: SourceDTO[]; suggested: SourceDTO[] }) {
  const [sources, setSources] = useState(initial);
  const [suggestions, setSuggestions] = useState(suggested);
  useEffect(() => { setSources(initial); setSuggestions(suggested); }, [initial, suggested]);
  const refresh = useCallback(async () => {
    const res = await fetch("/api/sources");
    if (res.ok) { const b = await res.json(); setSources(b.sources); setSuggestions(b.suggestions); }
  }, []);
  const anySyncing = sources.some((s) => s.syncing || s.status === "pending");
  useEffect(() => {
    if (!anySyncing) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [anySyncing, refresh]);

  const counts = sources.reduce((m, s) => { m[s.status] = (m[s.status] ?? 0) + 1; return m; }, {} as Record<string, number>);
  return (
    <>
      <section aria-labelledby="add-brand" style={{ borderTop: "1px solid var(--line)", paddingTop: 24 }}>
        <h2 id="add-brand" className="sr-only">Add a brand</h2>
        <AddBrandForm onDone={refresh} />
      </section>
      <p className="meta" style={{ marginTop: 32 }}>
        {sources.length} brand{sources.length === 1 ? "" : "s"} · {counts.ok ?? 0} connected{counts.partial ? ` · ${counts.partial} partial` : ""}
        {counts.error ? ` · ${counts.error} failing` : ""}{counts.manual ? ` · ${counts.manual} manual` : ""}{counts.unsupported ? ` · ${counts.unsupported} need setup` : ""}
      </p>
      {sources.length === 0 && <p className="muted" style={{ marginTop: 16 }}>You don’t follow any brands yet. Add one above, or follow a suggestion below.</p>}
      <ul className="brand-list" style={{ marginTop: 12 }}>
        {sources.map((s) => <BrandRow key={s.id} s={s} onChange={refresh} />)}
      </ul>
      <Suggestions items={suggestions} title="More brands on the shop" />
    </>
  );
}
