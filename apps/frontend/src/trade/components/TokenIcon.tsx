"use client";

import { useState } from "react";
import { iconFor } from "@/trade/lib/near";

/** A token's picture from the shared token list, or a coloured tile with its first letters when there is none. */
export function TokenIcon({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = iconFor(symbol);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="shrink-0 rounded-full bg-raised object-cover" style={{ width: size, height: size }} />
    );
  }
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${h} 55% 42%)` }}>
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
