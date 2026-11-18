"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { TokenIcon } from "@/trade/components/TokenIcon";
import { chainName, type NearToken } from "@/trade/lib/near";

/** Searchable list of assets across chains. */
export function TokenPicker({ tokens, onPick, hide }: { tokens: NearToken[]; onPick: (t: NearToken) => void; hide?: (t: NearToken) => boolean }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tokens
      .filter((t) => !hide?.(t) && (!s || t.symbol.toLowerCase().includes(s) || chainName(t.chain).toLowerCase().includes(s)))
      .sort((a, b) => Number(["USDC", "USDT", "ETH", "BTC", "SOL"].includes(b.symbol)) - Number(["USDC", "USDT", "ETH", "BTC", "SOL"].includes(a.symbol)))
      .slice(0, 60);
  }, [tokens, q, hide]);
  return (
    <div className="mt-3">
      <div className="flex h-14 items-center gap-3 rounded-2xl bg-surface px-4">
        <Search size={20} className="text-mute" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Coin or network" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
      </div>
      <div className="mt-2 max-h-[48vh] divide-y divide-white/5 overflow-y-auto">
        {shown.map((t) => (
          <button key={t.assetId} type="button" onClick={() => onPick(t)} className="flex h-16 w-full items-center gap-3 text-left">
            <TokenIcon symbol={t.symbol} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-base font-bold">{t.symbol}</span>
              <span className="block text-base text-mute">{chainName(t.chain)}</span>
            </span>
          </button>
        ))}
        {shown.length === 0 && <div className="py-8 text-center text-base text-mute">Nothing found</div>}
      </div>
    </div>
  );
}
