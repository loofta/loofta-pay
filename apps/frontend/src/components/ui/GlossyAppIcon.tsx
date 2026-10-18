"use client";

import type { CSSProperties } from "react";
import Image from "next/image";

/**
 * Glossy platform / token icon — ported from loofta-pay-private (Hush) AppIcon.
 * Soft chrome rim light + inset gloss; keeps Loofta product surfaces free of hard borders.
 */
export type GlossyAppIconProps = {
  src: string;
  name: string;
  /** Brand fill behind the logo (Venmo blue, Cash App green, …). */
  bg: string;
  /** CSS padding around the logo inside the tile (e.g. "20%" for Revolut). */
  pad?: string;
  size?: number | string;
  radius?: string;
  className?: string;
  style?: CSSProperties;
};

const glossStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  borderRadius: "inherit",
  background:
    "linear-gradient(160deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.1) 36%,rgba(255,255,255,0) 50%,rgba(0,0,0,.2) 100%)",
  boxShadow:
    "inset 0 2px 1px rgba(255,255,255,.7),inset 0 -12px 22px rgba(0,0,0,.28)",
  pointerEvents: "none",
};

export function GlossyAppIcon({
  src,
  name,
  bg,
  pad = "0",
  size = 40,
  radius = "28%",
  className,
  style,
}: GlossyAppIconProps) {
  const dim = typeof size === "number" ? `${size}px` : size;
  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        width: dim,
        height: dim,
        borderRadius: radius,
        overflow: "hidden",
        background: bg,
        flexShrink: 0,
        ...style,
      }}
    >
      <Image
        src={src}
        alt={name}
        width={96}
        height={96}
        unoptimized
        className="block h-full w-full object-contain"
        style={{ padding: pad }}
      />
      <span style={glossStyle} aria-hidden />
    </span>
  );
}

/** Peer cash-out destinations — same four rails as hush / BalanceModal Peer. */
export const PEER_GLOSSY_DESTS = [
  {
    id: "venmo",
    name: "Venmo",
    src: "/images/platforms/venmo.png",
    bg: "#3396cd",
    pad: "0",
    glow: "rgba(51,150,205,.85)",
    tint: "#123a52",
    note: "USD",
  },
  {
    id: "cashapp",
    name: "Cash App",
    src: "/images/platforms/cashapp.webp",
    bg: "#00D54B",
    pad: "0",
    glow: "rgba(0,213,75,.75)",
    tint: "#0d4421",
    note: "USD",
  },
  {
    id: "revolut",
    name: "Revolut",
    src: "/images/platforms/revolut.png",
    bg: "#F4F4F6",
    pad: "18%",
    glow: "rgba(255,255,255,.35)",
    tint: "#2c2c33",
    note: "USD · EUR · GBP",
  },
  {
    id: "zelle",
    name: "Zelle",
    src: "/images/platforms/zelle.png",
    bg: "#6D1ED4",
    pad: "0",
    glow: "rgba(109,30,212,.9)",
    tint: "#2e1059",
    note: "To their bank",
  },
  {
    id: "xmoney",
    name: "X Money",
    src: "/images/platforms/xmoney.jpg",
    bg: "#000000",
    pad: "0",
    glow: "rgba(255,255,255,.45)",
    tint: "#141414",
    note: "USD",
  },
] as const;

/** Overlapping BTC / SOL / ETH stack — hush-style “any crypto” mark, not a sparkles glyph. */
export function CryptoStackIcon({ size = 44 }: { size?: number }) {
  const stack = [
    { src: "/images/btc.svg", name: "BTC", bg: "#F7931A", pad: "0" },
    { src: "/images/sol.png", name: "SOL", bg: "#0b0b10", pad: "18%" },
    { src: "/images/eth.svg", name: "ETH", bg: "#627EEA", pad: "16%" },
  ] as const;
  const coinSize = Math.round(size * 0.78);
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size + 10, height: size }}
      aria-hidden
    >
      {stack.map((c, i) => (
        <span
          key={c.name}
          className="absolute"
          style={{
            left: `${i * 22}%`,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: i + 1,
            filter: "drop-shadow(0 6px 10px rgba(0,0,0,.45))",
          }}
        >
          <GlossyAppIcon
            src={c.src}
            name={c.name}
            bg={c.bg}
            pad={c.pad}
            size={coinSize}
            radius="999px"
          />
        </span>
      ))}
    </span>
  );
}
