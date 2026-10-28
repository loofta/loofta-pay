"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { WalletTokenLogo } from "@/components/wallet/WalletTokenLogo";
import { FIELD_BOX, FIELD_INPUT } from "@/components/wallet/walletStyles";

export type PickToken = {
  mint: string;
  symbol: string;
  name: string;
  icon?: string | null;
  decimals: number;
  usdPrice?: number | null;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
const shortMint = (m: string) => `${m.slice(0, 4)}...${m.slice(-4)}`;

/** Token list for the swap: your tokens first, then Jupiter's popular ones. Search by name, symbol or mint address. */
export function JupiterTokenPicker({
  yours,
  exclude,
  onPick,
  yoursOnly = false,
}: {
  yours: Array<PickToken & { balance: number }>;
  exclude?: string;
  onPick: (t: PickToken) => void;
  /** Pay side: only tokens you actually hold. */
  yoursOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<PickToken[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (yoursOnly) return;
    const id = ++reqRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/tokens/jupiter/search?q=${encodeURIComponent(query.trim())}`);
        const json = (await r.json()) as { tokens?: Array<PickToken & { verified?: boolean }> };
        if (reqRef.current === id) setRemote(json.tokens ?? []);
      } catch {
        if (reqRef.current === id) setRemote([]);
      } finally {
        if (reqRef.current === id) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, yoursOnly]);

  const q = query.trim().toLowerCase();
  const matches = (t: PickToken) => !q || `${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(q);
  const mine = yours.filter((t) => t.mint !== exclude && matches(t));
  const mineMints = new Set(mine.map((t) => t.mint));
  const others = yoursOnly ? [] : remote.filter((t) => t.mint !== exclude && !mineMints.has(t.mint));

  const row = (t: PickToken, right: string, sub: string) => (
    <button key={t.mint} type="button" onClick={() => onPick(t)} className="lh-9" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 16, textAlign: "left", background: "#1A1A20", border: "1px solid rgba(255,255,255,0.06)", color: "#F2EFE8" }}>
      <WalletTokenLogo symbol={t.symbol || "?"} chain="Solana" logo={t.icon ?? undefined} mint={t.mint} size={40} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.symbol || shortMint(t.mint)}</span>
        <span style={{ fontSize: 13, color: "#77757F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#C9C6CF" }}>{right}</span>
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={FIELD_BOX}>
        <Search size={20} color="#9A98A3" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, symbol or paste a mint address" aria-label="Search tokens" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={FIELD_INPUT} />
      </label>

      {mine.length > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: "#77757F", padding: "4px 6px 0" }}>Your tokens</span>}
      {mine.map((t) => row(t, t.balance.toLocaleString("en-US", { maximumFractionDigits: 5 }), t.name))}

      {!yoursOnly && (
        <>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#77757F", padding: "4px 6px 0" }}>{q ? "Results" : "Popular"}</span>
          {loading && others.length === 0 && <span style={{ fontSize: 14, color: "#77757F", padding: "0 6px" }}>Loading…</span>}
          {others.map((t) => row(t, t.usdPrice ? money(t.usdPrice) : "", `${t.name}  ${shortMint(t.mint)}`))}
          {!loading && others.length === 0 && mine.length === 0 && <span style={{ fontSize: 14, color: "#77757F", padding: "0 6px" }}>No token found. Paste the full mint address to find any token.</span>}
        </>
      )}
      {yoursOnly && mine.length === 0 && <span style={{ fontSize: 14, color: "#77757F", padding: "0 6px" }}>No token matches.</span>}
    </div>
  );
}
