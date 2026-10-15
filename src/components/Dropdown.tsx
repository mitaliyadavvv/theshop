"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "./icons";

export type Option = { id: string; label: string; count?: number };

type Props = {
  trigger: React.ReactNode;
  ariaLabel: string;
  variant?: "text" | "chip";
  align?: "left" | "right";
  active?: boolean;
  badge?: number;
} & (
  | { options: Option[]; selected: string[]; multi?: boolean; onChange: (ids: string[]) => void; allLabel?: string; panel?: never }
  | { panel: (close: () => void) => React.ReactNode; options?: never; selected?: never; multi?: never; onChange?: never; allLabel?: never }
);

/** Listbox dropdown (single or multi-select) or a free-form panel, with full keyboard support. */
export function Dropdown(props: Props) {
  const { trigger, ariaLabel, variant = "chip", align = "left", active, badge } = props;
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const opts: Option[] = props.options ? [{ id: "__all", label: props.allLabel ?? "All" }, ...props.options] : [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    if (props.options) list.current?.focus();
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, props.options]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const close = () => { setOpen(false); btn.current?.focus(); };

  const choose = (o: Option) => {
    if (!props.options) return;
    if (o.id === "__all") { props.onChange([]); close(); return; }
    if (props.multi) {
      const s = new Set(props.selected);
      if (s.has(o.id)) s.delete(o.id); else s.add(o.id);
      props.onChange([...s]);
    } else {
      props.onChange([o.id]);
      close();
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, opts.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); setCursor(0); }
    else if (e.key === "End") { e.preventDefault(); setCursor(opts.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(opts[cursor]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") setOpen(false);
    else if (/^\w$/.test(e.key)) {
      const i = opts.findIndex((o, j) => j > 0 && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setCursor(i);
    }
  };

  return (
    <div className="dd" ref={root}>
      <button ref={btn} type="button"
        className={variant === "text" ? "dd__trigger--text" : "chip"}
        data-active={active || undefined}
        aria-haspopup={props.options ? "listbox" : "dialog"} aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => { setOpen((o) => !o); setCursor(0); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>
        {trigger}
        {badge ? <span className="chip__badge">{badge}</span> : null}
        <ChevronDown />
      </button>
      {open && props.options && (
        <ul ref={list} id={id} className={`dd__menu${align === "right" ? " dd__menu--right" : ""}`} role="listbox"
          aria-label={ariaLabel} aria-multiselectable={props.multi || undefined} tabIndex={-1}
          aria-activedescendant={`${id}-${cursor}`} onKeyDown={onListKey}>
          {opts.map((o, i) => {
            const selected = o.id === "__all" ? props.selected.length === 0 : props.selected.includes(o.id);
            return (
              <li key={o.id} id={`${id}-${i}`} data-i={i} role="option" aria-selected={selected} className="dd__opt"
                data-active={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => choose(o)}>
                {props.multi && o.id !== "__all" && <span className="dd__tick" aria-hidden />}
                {o.label}
                {o.count != null && <span className="dd__count">{o.count}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {open && props.panel && (
        <div id={id} className={`dd__menu${align === "right" ? " dd__menu--right" : ""}`} role="dialog" aria-label={ariaLabel}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
          {props.panel(close)}
        </div>
      )}
    </div>
  );
}
