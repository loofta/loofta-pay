"use client";

import { useState } from "react";
import { cmcLogoForSymbol } from "@/lib/tokenImages";
import { getChainIcon } from "@/lib/chains";

const LOCAL_LOGOS: Record<string, string> = {
  USDC: "/images/usdc.svg",
  SOL: "/images/solana.png",
};

export function WalletTokenLogo({ symbol, chain, logo, mint, size = 46 }: { symbol: string; chain: string; logo?: string; mint?: string | null; size?: number }) {
  const local = LOCAL_LOGOS[symbol.toUpperCase()];
  // Token icons live on many hosts the page CSP does not allow, so by mint we load them through our own /api route.
  const sources = [mint ? `/api/tokens/image?mint=${mint}` : logo, cmcLogoForSymbol(symbol), local].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState(sources[0]);
  if (sources[0] !== prev) {
    setPrev(sources[0]);
    setIdx(0);
  }
  const src = sources[idx];
  const chainSrc = getChainIcon(chain);
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={symbol}
          width={size}
          height={size}
          loading="lazy"
          style={{ borderRadius: 999, objectFit: "cover", background: "#22222A", width: size, height: size }}
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <div style={{ width: size, height: size, borderRadius: 999, background: "#2A2A33", display: "grid", placeItems: "center", fontWeight: 800, fontSize: Math.round(size * 0.32), color: "#F2EFE8" }}>
          {symbol.slice(0, 3).toUpperCase()}
        </div>
      )}
      {chainSrc && size >= 40 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={chainSrc} alt={chain} width={Math.round(size * 0.42)} height={Math.round(size * 0.42)} style={{ position: "absolute", right: -3, bottom: -3, borderRadius: 999, background: "#141419", border: "2px solid #141419" }} />
      )}
    </div>
  );
}
