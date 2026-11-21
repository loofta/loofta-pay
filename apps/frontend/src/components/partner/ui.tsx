"use client";

import type { ReactNode } from "react";
import { highlight } from "./highlight";

/** Sizes and colours follow the partner portal design file exactly. */
export const ORANGE = "#FF6A1F";
const MONO_LABEL = "font-mono text-[11.5px] uppercase tracking-[0.12em] text-[color:var(--pt-ink3,#9C9CA5)]";

/** Small mono label, used for breadcrumbs, stat labels and table headers. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-[color:var(--pt-ink3,#9C9CA5)]">{children}</div>;
}

/** Big title, one line of description and the screen's main actions on the right. (The breadcrumb prop is kept so screens still compile, but the design has none.) */
export function PageHeader({ title, blurb, actions, corner }: { crumb?: string; title: string; blurb?: string; actions?: ReactNode; corner?: ReactNode }) {
  return (
    <header className="mb-12 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="m-0 font-bold leading-[1.05] tracking-[-0.035em] text-[#1D1D1F]" style={{ fontSize: "clamp(34px,3.6vw,44px)" }}>
          {title}
        </h1>
        {blurb && <p className="m-0 max-w-[640px] text-[17px] leading-[1.5] text-[#6E6E73]">{blurb}</p>}
      </div>
      {(actions || corner) && (
        <div className="flex flex-wrap items-center gap-2.5">
          {actions}
          {corner}
        </div>
      )}
    </header>
  );
}

/** A section: heading and description, an optional control on the right, then content. */
export function Section({ title, desc, right, children }: { title: string; desc?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <section className="mt-12 flex flex-col gap-[18px] first:mt-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[24px] font-bold tracking-[-0.025em] text-[#1D1D1F]">{title}</h2>
          {desc && <p className="m-0 max-w-[760px] text-[15px] leading-[1.55] text-[#6E6E73]">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Settings-style row: title and help on the left, the form on the right. */
export function SplitSection({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="flex flex-wrap gap-x-10 gap-y-6 border-t border-[color:var(--pt-w0p07,rgba(255,255,255,0.07))] py-7 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
        <h2 className="m-0 text-[22.5px] font-semibold text-[color:var(--pt-ink,#EDEDEF)]">{title}</h2>
        {desc && <p className="m-0 text-[14.5px] leading-[1.55] text-[color:var(--pt-ink2,#C9C9D0)]">{desc}</p>}
      </div>
      <div className="flex min-w-0 flex-[3_1_460px] flex-col gap-5">{children}</div>
    </section>
  );
}

const DOT: Record<string, string> = {
  grey: "bg-[color:var(--pt-ink2,#C9C9D0)]",
  blue: "bg-[#86A8FF]",
  amber: "bg-[#F2B55A]",
  green: "bg-[#1F9D55]",
};

export function StatCard({ label, value, hint, dot }: { label: string; value: string; hint?: string; dot?: keyof typeof DOT }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-[18px] bg-[#FAFAFB] p-5 shadow-[0_0_0_1px_#EDEDF0]">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#6E6E73]">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot ? DOT[dot] : "bg-[#C7C7CC]"}`} />
        {label}
      </div>
      <div className="text-[clamp(26px,2.6vw,32px)] font-bold tabular-nums tracking-[-0.03em] text-[#1D1D1F]">{value}</div>
      {hint && <div className="text-[13px] text-[#86868B]">{hint}</div>}
    </div>
  );
}

/** Older name kept so any screen not yet moved over still renders. */
export const Stat = StatCard;

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-[18px] bg-[#FAFAFB] p-5 shadow-[0_0_0_1px_#EDEDF0]">
      {(title || right) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          {title && <h2 className="m-0 text-[20px] font-bold tracking-[-0.02em] text-[#1D1D1F]">{title}</h2>}
          {right}
        </div>
      )}
      <div className="text-[15px] leading-[1.6] text-[#4F4F57]">{children}</div>
    </section>
  );
}

/** Rounded table card: mono header row, then rows separated by hairlines. */
export function Table({ cols, children, template }: { cols: string[]; children: ReactNode; template: string }) {
  return (
    <div className="overflow-x-auto rounded-[18px] shadow-[0_0_0_1px_#EDEDF0]">
      <div className="min-w-[640px]">
        <div className="grid gap-3 bg-[#FAFAFB] px-[18px] py-3 text-[12.5px] font-medium text-[#86868B]" style={{ gridTemplateColumns: template }}>
          {cols.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Row({ template, children, onClick }: { template: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`grid items-center gap-3 border-t border-[color:var(--pt-w0p06,rgba(255,255,255,0.06))] px-[18px] py-3.5 text-[14.5px] text-[color:var(--pt-ink,#EDEDEF)] hover:bg-[color:var(--pt-w0p02,rgba(255,255,255,0.02))] ${onClick ? "cursor-pointer" : ""}`}
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[color:var(--pt-surface3,#1E1E22)] font-bold text-[color:var(--pt-ink-soft,#DCDCE1)]"
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.42) }}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

const PILL: Record<string, { fg: string; bg: string }> = {
  grey: { fg: "#C9C9D0", bg: "rgba(255,255,255,0.06)" },
  blue: { fg: "#86A8FF", bg: "rgba(134,168,255,0.12)" },
  amber: { fg: "#F2B55A", bg: "rgba(242,181,90,0.12)" },
  green: { fg: "#5FD49C", bg: "rgba(95,212,156,0.12)" },
  red: { fg: "#FF8A5C", bg: "rgba(255,138,92,0.12)" },
};

export function Pill({ tone = "grey", dot, children }: { tone?: keyof typeof PILL; dot?: boolean; children: ReactNode }) {
  const c = PILL[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[12.5px] font-semibold" style={{ color: c.fg, background: c.bg }}>
      {dot && <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.fg }} />}
      {children}
    </span>
  );
}

/** Quiet tag, like the Email / Twitter label on Recipients or a role on Team. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-[color:var(--pt-w0p06,rgba(255,255,255,0.06))] px-2 py-[3px] text-[12.5px] text-[color:var(--pt-ink-soft,#DCDCE1)]">{children}</span>;
}

/** Segmented filter, like the All / Created / Funded control on Activity. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-[10px] border border-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] bg-[color:var(--pt-surface2,#0F0F11)] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[7px] px-3 py-[7px] text-[13.5px] font-semibold ${value === o.value ? "bg-[color:var(--pt-w0p08,rgba(255,255,255,0.08))] text-[color:var(--pt-ink,#EDEDEF)]" : "text-[color:var(--pt-ink2b,#B4B4BC)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  kind = "primary",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
}) {
  const style =
    kind === "primary"
      ? "bg-[#FF4A1C] text-white shadow-[0_6px_16px_-6px_rgba(255,74,28,0.55)] hover:bg-[#F03E10] font-semibold"
      : kind === "danger"
        ? "bg-[#FFF0EC] text-[#D8481A] hover:bg-[#FFE4DC] font-medium"
        : "bg-[#F2F2F4] text-[#1D1D1F] hover:bg-[#E8E8ED] font-medium";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-[11px] text-[14px] transition disabled:cursor-not-allowed disabled:opacity-40 ${style} ${className}`}
    >
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-[12px] border border-[#E5E5EA] bg-white px-3.5 py-[11px] text-[15px] text-[#1D1D1F] outline-none transition placeholder:text-[#9A9AA2] focus:border-[#FF4A1C] focus:shadow-[0_0_0_3px_rgba(255,74,28,0.12)]";

export function Field({ label, children, hint, optional }: { label: string; children: ReactNode; hint?: string; optional?: boolean }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[14px] font-semibold text-[color:var(--pt-ink,#EDEDEF)]">
        {label}
        {optional && <span className="font-medium text-[color:var(--pt-ink3,#9C9CA5)]"> (optional)</span>}
      </span>
      {children}
      {hint && <span className="text-[13px] leading-[1.5] text-[color:var(--pt-ink3,#9C9CA5)]">{hint}</span>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const cls =
    kind === "error"
      ? "border-[#FF8A5C]/30 bg-[#FF8A5C]/10 text-[color:var(--pt-warn,#FFB59A)]"
      : kind === "ok"
        ? "border-[#5FD49C]/30 bg-[#5FD49C]/10 text-[color:var(--pt-ok,#9BE6C3)]"
        : "border-[color:var(--pt-w10,rgba(255,255,255,0.1))] bg-[color:var(--pt-w5,rgba(255,255,255,0.05))] text-[color:var(--pt-ink-soft,#DCDCE1)]";
  return <div className={`rounded-[10px] border px-4 py-3 text-[14.5px] leading-[1.6] ${cls}`}>{children}</div>;
}

export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.5 2H3.5A1.5 1.5 0 0 0 2 3.5V9.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ArrowIcon() {
  return <span aria-hidden>→</span>;
}

/** Mono code box with a title bar and a copy action, like the deposit address on Payouts. */
export function CodeBox({ title, value, copied, onCopy, mono = true, plain = false }: { title: string; value: string; copied: boolean; onCopy: () => void; mono?: boolean; /** Skip colouring, for addresses and keys. */ plain?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-[#2A2A30] bg-[#14141A]">
      <div className="flex items-center justify-between border-b border-[#2A2A30] px-[18px] py-3">
        <span className="font-mono text-[12.5px] text-[#9C9CA5]">{title}</span>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 text-[13px] text-[#C9C9D0] hover:text-white">
          <CopyIcon />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={`m-0 overflow-x-auto whitespace-pre-wrap break-all p-[18px] text-[15px] leading-[1.7] text-[#EDEDEF] ${mono ? "font-mono" : ""}`}>{plain ? value : highlight(value)}</pre>
    </div>
  );
}

/** An action row aligned to the right. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center justify-end gap-3">{children}</div>;
}
