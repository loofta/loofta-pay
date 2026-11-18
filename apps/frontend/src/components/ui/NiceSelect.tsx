"use client";

import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

export type NiceOption<T extends string | number> = { value: T; label: string; hint?: string };

/**
 * A dark, themed dropdown that replaces the browser's native select (which draws the laptop's own menu).
 * Keyboard: arrows move, Enter picks, Escape closes. Opens upward when there is no room below.
 */
export function NiceSelect<T extends string | number>({ value, options, onChange, disabled, className, buttonClassName, align = "left", placeholder = "Select" }: { value: T; options: Array<NiceOption<T>>; onChange: (v: T) => void; disabled?: boolean; className?: string; buttonClassName?: string; align?: "left" | "right"; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const show = () => {
    if (disabled) return;
    const r = root.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < Math.min(280, options.length * 44 + 16) && r.top > window.innerHeight - r.bottom);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) pick(options[active].value);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className={clsx("relative", className)}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={clsx("flex w-full items-center justify-between gap-3 rounded-xl border bg-[#0F0F11] px-4 py-2.5 text-left text-base text-[#EDEDEF] outline-none transition-colors hover:bg-white/[0.04] focus-visible:border-[#EAB308]/70 disabled:cursor-not-allowed disabled:opacity-50", open ? "border-[#EAB308]/70" : "border-white/10", buttonClassName)}
      >
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown size={18} className={clsx("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul id={id} role="listbox" className={clsx("absolute z-[80] max-h-72 min-w-full overflow-y-auto rounded-xl border border-white/10 bg-[#17171b] p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)]", up ? "bottom-full mb-2" : "top-full mt-2", align === "right" ? "right-0" : "left-0")}>
          {options.map((o, i) => (
            <li
              key={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.value)}
              className={clsx("flex cursor-pointer items-center justify-between gap-4 whitespace-nowrap rounded-lg px-3 py-2.5 text-base", i === active ? "bg-white/[0.08] text-white" : "text-slate-300", o.value === value && "font-semibold text-white")}
            >
              <span>
                {o.label}
                {o.hint && <span className="ml-2 text-slate-500">{o.hint}</span>}
              </span>
              {o.value === value && <Check size={16} className="text-[#EAB308]" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
