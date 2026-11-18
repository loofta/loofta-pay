"use client";

import clsx from "clsx";
import { useState, type CSSProperties, type ReactNode } from "react";
import { avatarBackground } from "@/trade/lib/memecoin";
import { imgSrc } from "@/trade/lib/img";

/** Coin picture, or a glossy gradient tile with initials when there is no image. */
export function Avatar({ mint, symbol, src, size = 48 }: { mint: string; symbol: string; src: string | null; size?: number }) {
  const style: CSSProperties = { width: size, height: size, borderRadius: size * 0.34 };
  const [failed, setFailed] = useState(false);
  const url = imgSrc(src);
  // A dead image falls back to the gradient initials tile instead of an empty hole.
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        loading="lazy"
        style={style}
        className="shrink-0 bg-raised object-cover shadow-[0_4px_0_#050507]"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      style={{ ...style, background: avatarBackground(mint), fontSize: size * 0.34 }}
      className="grid shrink-0 place-items-center font-display font-bold text-white shadow-[inset_0_3px_6px_rgba(255,255,255,0.35),inset_0_-6px_10px_rgba(0,0,0,0.25),0_4px_0_#050507]"
    >
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}

/** A glossy 3D tile holding an icon or image. */
export function Tile({ tone, size = 56, className, children }: { tone?: "brand" | "green" | "gold" | "blue"; size?: number; className?: string; children: ReactNode }) {
  return (
    <div
      style={{ width: size, height: size, borderRadius: size * 0.34 }}
      className={clsx("tile3d grid shrink-0 place-items-center", tone, className)}
    >
      {children}
    </div>
  );
}

export function Pill({ color, bg, border, children }: { color: string; bg: string; border: string; children: ReactNode }) {
  return (
    <span style={{ color, background: bg, borderColor: border }} className="inline-flex items-center rounded-full border px-3 py-1 text-base font-semibold">
      {children}
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-lg font-bold">{children}</h2>
      {right}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex gap-1 rounded-2xl bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={clsx(
            "h-11 flex-1 rounded-xl font-display text-base font-semibold transition-colors",
            value === o.id ? "bg-raised text-ink shadow-[0_2px_0_#0a0a0d]" : "text-mute",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 py-1 text-left" role="switch" aria-checked={on}>
      <span className="text-base font-semibold">{label}</span>
      <span className={clsx("relative h-8 w-14 shrink-0 rounded-full transition-colors", on ? "bg-up" : "bg-raised")}>
        <span className={clsx("absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all", on ? "left-7" : "left-1")} />
      </span>
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

const CONFETTI = ["#ff2d0a", "#f5b70c", "#3cb371", "#9cc8ff", "#ffc79a", "#c49bff"];

/** Short burst of confetti, centred on its parent. Purely decorative. */
export function ConfettiBurst() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 26 }).map((_, i) => {
        const angle = (i / 26) * Math.PI * 2;
        const dist = 90 + ((i * 37) % 80);
        const style = {
          background: CONFETTI[i % CONFETTI.length],
          "--dx": `${Math.cos(angle) * dist}px`,
          "--dy": `${Math.sin(angle) * dist - 30}px`,
          "--rot": `${(i * 73) % 360}deg`,
          animationDelay: `${(i % 5) * 25}ms`,
        } as CSSProperties;
        return <span key={i} className="confetti-bit" style={style} />;
      })}
    </div>
  );
}
