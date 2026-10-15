"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

/** Accessible modal: focus trap, Escape to close, restores focus, locks scroll. */
export function Modal({ open, onClose, title, kind = "dialog", children, footer, labelledHidden }: {
  open: boolean; onClose: () => void; title: string; kind?: "dialog" | "sheet";
  children: React.ReactNode; footer?: React.ReactNode; labelledHidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const f = focusables(); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={ref} className={kind} role="dialog" aria-modal="true" aria-label={title}>
        {!labelledHidden && (
          <div className="dialog__head">
            <h2>{title}</h2>
            <button className="icon-btn dialog__close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
          </div>
        )}
        {kind === "sheet" ? <div className="sheet__body">{children}</div> : <div className={labelledHidden ? "" : "dialog__body"}>{children}</div>}
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
