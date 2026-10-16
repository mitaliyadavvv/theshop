"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { useSaved } from "./SavedProvider";
import { SearchOverlay } from "./SearchOverlay";
import { Modal } from "./Modal";
import { AddBrandForm } from "./AddBrandForm";
import { HeartIcon, PlusIcon, SearchIcon } from "./icons";
import { Dropdown } from "./Dropdown";
import { supabaseBrowser } from "@/lib/supabase/client";

const NAV = [
  { href: "/", label: "Discover" },
  { href: "/new", label: "New drops" },
  { href: "/colours", label: "Colours" },
  { href: "/brands", label: "Brands" },
];

function Wordmark() {
  // Render a trailing "." in orange if the configured name has one.
  const name = site.name;
  const dot = name.endsWith(".");
  return <Link href="/" className="wordmark" aria-label={`${name} home`}>{dot ? name.slice(0, -1) : name}{dot && <span className="wordmark__dot">.</span>}</Link>;
}

function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    await supabaseBrowser().auth.signOut();
    router.replace("/");
    router.refresh();
  };
  return (
    <div className="account-menu">
      <Dropdown variant="text" align="right" ariaLabel="Account" trigger={<span className="account-menu__btn" aria-hidden>{email[0]}</span>}
        panel={() => (
          <div className="dd__panel">
            <span className="meta">Signed in as</span>
            <span style={{ overflowWrap: "anywhere" }}>{email}</span>
            <div className="dd__sep" />
            <Link href="/brands" className="link">My brands</Link>
            <Link href="/saved" className="link">Saved</Link>
            <Link href="/forgot-password" className="link">Change password</Link>
            <button className="btn btn--sm btn--ghost" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
          </div>
        )} />
    </div>
  );
}

export function Header({ user }: { user: { email: string | null } | null }) {
  const path = usePathname();
  const { count } = useSaved();
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const links = (cls: string) => (
    <nav className={cls} aria-label="Main">
      {NAV.map((n) => <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>{n.label}</Link>)}
    </nav>
  );

  return (
    <header className="header">
      <div className="wrap">
        <div className="header__row">
          <Wordmark />
          {links("nav nav--desktop")}
          <div className="header__actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search">
              <SearchIcon /><span className="search-trigger__label">Search</span><kbd>/</kbd>
            </button>
            <Link href={user ? "/saved" : "/login?next=/saved"} className="icon-btn saved-link" aria-label={`Saved products (${count})`} aria-current={path === "/saved" ? "page" : undefined}>
              <HeartIcon width={18} height={18} />
              {count > 0 && <span className="saved-link__count">{count}</span>}
            </Link>
            {user ? (
              <button className="btn btn--sm add-brand-btn" onClick={() => setAddOpen(true)} aria-label="Add brand">
                <PlusIcon width={14} height={14} /><span className="add-brand-label">Add brand</span>
              </button>
            ) : (
              <Link className="btn btn--sm" href={`/login${path && path !== "/" ? `?next=${encodeURIComponent(path)}` : ""}`}>Sign in</Link>
            )}
            {user?.email && <AccountMenu email={user.email} />}
          </div>
        </div>
        {links("header__mobile-nav")}
      </div>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a brand">
        <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
          Paste a brand’s website or a collection link. We’ll look for a public product feed and import what’s there.
          Instagram profiles are saved as manual sources.
        </p>
        <AddBrandForm compact />
      </Modal>
    </header>
  );
}
