"use client";

import type { ReactNode } from "react";

/** Sizes and colours follow the partner portal design file exactly. */
export const ORANGE = "#FF6A1F";
const MONO_LABEL = "font-mono text-[11.5px] uppercase tracking-[0.12em] text-[#9C9CA5]";

/** Small mono label, used for breadcrumbs, stat labels and table headers. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[12.5px] uppercase tracking-[0.14em] text-[#9C9CA5]">{children}</div>;
}

/** Breadcrumb, big title, one line of description and the screen's main actions. `corner` sits at the top right. */
export function PageHeader({ crumb, title, blurb, actions, corner }: { crumb: string; title: string; blurb?: string; actions?: ReactNode; corner?: ReactNode }) {
  return (
    <header className="relative mb-10 flex flex-col gap-3.5">
      {corner && <div className="flex justify-end sm:absolute sm:right-0 sm:top-0">{corner}</div>}
      <Eyebrow>{crumb}</Eyebrow>
      <h1 className="m-0 font-semibold leading-[1.02] tracking-[-0.02em] text-[#EDEDEF]" style={{ fontSize: "clamp(34px,4.4vw,48px)" }}>
        {title}
      </h1>
      {blurb && <p className="m-0 max-w-[640px] text-[17.5px] leading-[1.55] text-[#C9C9D0]">{blurb}</p>}
      {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 pt-2">{actions}</div>}
    </header>
  );
}

/** A section: heading and description, an optional control on the right, a hairline, then content. */
export function Section({ title, desc, right, children }: { title: string; desc?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <section className="mt-12 flex flex-col gap-[18px] first:mt-0">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.07] pb-3.5">
        <div className="flex flex-col gap-1.5">
          <h2 className="m-0 text-[24.5px] font-semibold text-[#EDEDEF]">{title}</h2>
          {desc && <p className="m-0 max-w-[760px] text-[15px] leading-[1.6] text-[#C9C9D0]">{desc}</p>}
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
    <section className="flex flex-wrap gap-x-10 gap-y-6 border-t border-white/[0.07] py-7 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5">
        <h2 className="m-0 text-[22.5px] font-semibold text-[#EDEDEF]">{title}</h2>
        {desc && <p className="m-0 text-[14.5px] leading-[1.55] text-[#C9C9D0]">{desc}</p>}
      </div>
      <div className="flex min-w-0 flex-[3_1_460px] flex-col gap-5">{children}</div>
    </section>
  );
}

const DOT: Record<string, string> = {
  grey: "bg-[#C9C9D0]",
  blue: "bg-[#86A8FF]",
  amber: "bg-[#F2B55A]",
  green: "bg-[#5FD49C]",
};

export function StatCard({ label, value, hint, dot }: { label: string; value: string; hint?: string; dot?: keyof typeof DOT }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/[0.08] bg-[#121214] px-5 py-[18px]">
      <div className={`flex items-center gap-2 ${MONO_LABEL}`}>
        {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[dot]}`} />}
        {label}
      </div>
      <div className="text-[28.5px] font-semibold tracking-[-0.01em] text-[#EDEDEF]">{value}</div>
      {hint && <div className="text-[13.5px] text-[#B4B4BC]">{hint}</div>}
    </div>
  );
}

/** Older name kept so any screen not yet moved over still renders. */
export const Stat = StatCard;

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-white/[0.08] bg-[#121214] p-5">
      {(title || right) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          {title && <h2 className="m-0 text-[20.5px] font-semibold text-[#EDEDEF]">{title}</h2>}
          {right}
        </div>
      )}
      <div className="text-[15px] leading-[1.6] text-[#C9C9D0]">{children}</div>
    </section>
  );
}

/** Rounded table card: mono header row, then rows separated by hairlines. */
export function Table({ cols, children, template }: { cols: string[]; children: ReactNode; template: string }) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-white/[0.08]">
      <div className="min-w-[640px]">
        <div className="grid gap-3 bg-[#121214] px-[18px] py-3 font-mono text-[11.5px] uppercase tracking-[0.1em] text-[#9C9CA5]" style={{ gridTemplateColumns: template }}>
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
      className={`grid items-center gap-3 border-t border-white/[0.06] px-[18px] py-3.5 text-[14.5px] text-[#EDEDEF] hover:bg-white/[0.02] ${onClick ? "cursor-pointer" : ""}`}
      style={{ gridTemplateColumns: template }}
    >
      {children}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#1E1E22] font-bold text-[#DCDCE1]"
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
  return <span className="rounded-md bg-white/[0.06] px-2 py-[3px] text-[12.5px] text-[#DCDCE1]">{children}</span>;
}

/** Segmented filter, like the All / Created / Funded control on Activity. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-[10px] border border-white/[0.08] bg-[#0F0F11] p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[7px] px-3 py-[7px] text-[13.5px] font-semibold ${value === o.value ? "bg-white/[0.08] text-[#EDEDEF]" : "text-[#B4B4BC]"}`}
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
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
}) {
  const style =
    kind === "primary"
      ? "border-0 text-[#140803] hover:brightness-110"
      : kind === "danger"
        ? "border border-[#FF8A5C]/40 text-[#FF8A5C] hover:bg-[#FF8A5C]/10"
        : "border border-white/[0.12] text-[#EDEDEF] hover:bg-white/[0.05]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={kind === "primary" ? { background: ORANGE } : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-[11px] text-[14.5px] ${kind === "primary" ? "font-semibold" : "font-medium"} transition disabled:cursor-not-allowed disabled:opacity-40 ${style}`}
    >
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-[10px] border border-white/10 bg-[#0F0F11] px-3.5 py-[11px] text-[15px] text-[#EDEDEF] placeholder:text-[#85858F] focus:border-[#FF6A1F]/55 focus:outline-none";

export function Field({ label, children, hint, optional }: { label: string; children: ReactNode; hint?: string; optional?: boolean }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[14px] font-semibold text-[#EDEDEF]">
        {label}
        {optional && <span className="font-medium text-[#9C9CA5]"> (optional)</span>}
      </span>
      {children}
      {hint && <span className="text-[13px] leading-[1.5] text-[#9C9CA5]">{hint}</span>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const cls =
    kind === "error"
      ? "border-[#FF8A5C]/30 bg-[#FF8A5C]/10 text-[#FFB59A]"
      : kind === "ok"
        ? "border-[#5FD49C]/30 bg-[#5FD49C]/10 text-[#9BE6C3]"
        : "border-white/10 bg-white/5 text-[#DCDCE1]";
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
export function CodeBox({ title, value, copied, onCopy, mono = true }: { title: string; value: string; copied: boolean; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0F0F11]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-[18px] py-3">
        <span className="font-mono text-[12.5px] text-[#9C9CA5]">{title}</span>
        <button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 text-[13px] text-[#C9C9D0] hover:text-[#EDEDEF]">
          <CopyIcon />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={`m-0 overflow-x-auto whitespace-pre-wrap break-all p-[18px] text-[15px] leading-[1.7] text-[#EDEDEF] ${mono ? "font-mono" : ""}`}>{value}</pre>
    </div>
  );
}

/** An action row aligned to the right. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center justify-end gap-3">{children}</div>;
}
