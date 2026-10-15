import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p,
});

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>;
export const HeartIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" /></svg>;
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const ChevronDown = (p: SVGProps<SVGSVGElement>) => <svg {...base({ strokeWidth: 2, ...p })}><path d="m6 9 6 6 6-6" /></svg>;
export const ArrowUpRight = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M7 17 17 7M8 7h9v9" /></svg>;
export const SlidersIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>;
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4" /></svg>;
