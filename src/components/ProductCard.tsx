"use client";
import { useState } from "react";
import { useSaved } from "./SavedProvider";
import { HeartIcon } from "./icons";
import { formatPrice, imageAt } from "@/lib/format";
import { formatDate, releasedLabel } from "@/lib/dates";
import type { ProductDTO } from "@/lib/types";

function initials(s: string) {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function ProductCard({ p, priority = false }: { p: ProductDTO; priority?: boolean }) {
  const { isSaved, toggle } = useSaved();
  const [broken, setBroken] = useState(!p.imageUrl);
  const [loaded, setLoaded] = useState(false);
  const [bump, setBump] = useState(false);
  const saved = isSaved(p.id);

  const price = formatPrice(p.price, p.currency);
  const label = releasedLabel(p.releasedBasis);
  const date = p.releasedAt && label ? `${label} ${formatDate(p.releasedAt)}` : `First seen ${formatDate(p.firstSeenAt)}`;
  const priceVaries = p.priceMax != null && p.price != null && p.priceMax > p.price;

  return (
    <article className="card">
      <a className="card__link" href={p.url} target="_blank" rel="noopener noreferrer"
        aria-label={`${p.name} by ${p.brandName}${price ? `, ${price}` : ""} — opens ${p.brandName} in a new tab`}>
        <div className="card__media">
          {!broken && (
            <img src={imageAt(p.imageUrl, 640)!} alt="" loading={priority ? "eager" : "lazy"} decoding="async"
              ref={(el) => { if (el?.complete) { if (el.naturalWidth) setLoaded(true); else setBroken(true); } }}
              data-loaded={loaded} onLoad={() => setLoaded(true)} onError={() => setBroken(true)}
              srcSet={p.imageUrl?.includes("cdn.shopify.com") || p.imageUrl?.includes("/cdn/shop/") ? `${imageAt(p.imageUrl, 400)} 400w, ${imageAt(p.imageUrl, 640)} 640w, ${imageAt(p.imageUrl, 900)} 900w` : undefined}
              sizes="(max-width: 860px) 50vw, (max-width: 1180px) 33vw, 25vw" />
          )}
          {broken && <div className="card__ph" aria-hidden><div>{initials(p.brandName)}<small>No image</small></div></div>}
          <div className="card__flags">
            {p.isNew && <span className="flag flag--new">New</span>}
            {p.originalPrice != null && <span className="flag flag--sale">Sale</span>}
            {p.demo && <span className="flag flag--demo">Sample</span>}
            {p.manual && <span className="flag flag--manual">Added by you</span>}
          </div>
        </div>
        <div className="card__body">
          <span className="card__brand">{p.brandName}</span>
          <h3 className="card__name">{p.name}</h3>
          <div className="card__price">
            {price ? <span>{priceVaries ? "from " : ""}{price}</span> : <span className="muted">Price on site</span>}
            {p.originalPrice != null && <s aria-label={`was ${formatPrice(p.originalPrice, p.currency)}`}>{formatPrice(p.originalPrice, p.currency)}</s>}
            {p.available === false && <span className="card__oos meta">Sold out</span>}
          </div>
          <span className="card__date">{p.removed ? "No longer listed by the brand" : date}</span>
        </div>
      </a>
      <button className="save-btn" aria-pressed={saved} data-bump={bump}
        aria-label={saved ? `Remove ${p.name} from saved` : `Save ${p.name}`}
        onClick={() => { setBump(true); setTimeout(() => setBump(false), 400); toggle(p.id); }}>
        <HeartIcon />
      </button>
    </article>
  );
}

export function SkeletonGrid({ n = 8 }: { n?: number }) {
  return (
    <div className="grid" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card skeleton"><div className="card__media" /><div className="bar" /><div className="bar" /></div>
      ))}
    </div>
  );
}
