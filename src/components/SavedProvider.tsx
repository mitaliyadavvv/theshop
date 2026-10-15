"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Ctx = { ids: Set<string>; isSaved: (id: string) => boolean; toggle: (id: string) => Promise<void>; count: number; signedIn: boolean };
const SavedCtx = createContext<Ctx | null>(null);

/** Saved items live in the database; this keeps an optimistic client copy for instant feedback. */
export function SavedProvider({ initial, signedIn, children }: { initial: string[]; signedIn: boolean; children: React.ReactNode }) {
  const [ids, setIds] = useState(() => new Set(initial));
  const toggle = useCallback(async (id: string) => {
    if (!signedIn) {
      // Saving needs an account: send visitors to sign in, then back here.
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const next = !ids.has(id);
    setIds((s) => { const n = new Set(s); if (next) n.add(id); else n.delete(id); return n; });
    try {
      const res = await fetch("/api/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId: id, saved: next }) });
      if (!res.ok) throw new Error();
    } catch {
      setIds((s) => { const n = new Set(s); if (next) n.delete(id); else n.add(id); return n; }); // roll back
    }
  }, [ids, signedIn]);
  const value = useMemo(() => ({ ids, isSaved: (id: string) => ids.has(id), toggle, count: ids.size, signedIn }), [ids, toggle, signedIn]);
  return <SavedCtx.Provider value={value}>{children}</SavedCtx.Provider>;
}

export function useSaved() {
  const c = useContext(SavedCtx);
  if (!c) throw new Error("useSaved outside SavedProvider");
  return c;
}
