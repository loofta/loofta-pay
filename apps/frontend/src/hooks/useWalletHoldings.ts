"use client";

import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { getRpcForMode } from "@/lib/solanaRpc";
import { useSolPriceOrNull } from "@/hooks/useSolPrice";

export type WalletHolding = {
  id: string;
  /** SPL mint, or null for native SOL. */
  mint: string | null;
  symbol: string;
  name: string;
  chain: string;
  decimals: number;
  amount: number;
  /** null when no price feed has this token. */
  usd: number | null;
  /** 24h price change in percent, null when no feed has it. */
  change24h?: number | null;
  logo?: string;
};

const SOL_MINT = "So11111111111111111111111111111111111111112";
const KNOWN: Record<string, { symbol: string; name: string }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether" },
};

type TokenRow = { mint: string; decimals: number; amount: number };
type Meta = { symbol: string; name: string; logo?: string };

async function fetchTokenRows(address: string, rpc: string): Promise<TokenRow[]> {
  const conn = new Connection(rpc, "confirmed");
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(address), { programId: TOKEN_PROGRAM_ID });
  const byMint = new Map<string, TokenRow>();
  for (const { account } of res.value) {
    const info = account.data.parsed?.info;
    const ui = Number(info?.tokenAmount?.uiAmount ?? 0);
    if (!info?.mint || !(ui > 0)) continue;
    const prev = byMint.get(info.mint);
    byMint.set(info.mint, { mint: info.mint, decimals: Number(info.tokenAmount.decimals), amount: (prev?.amount ?? 0) + ui });
  }
  return [...byMint.values()];
}

type JupiterInfo = { symbol: string | null; name: string | null; icon: string | null; usdPrice: number | null; change24h: number | null };

/** Logos, names and USD prices from Jupiter, via our own /api route (key stays server-side). */
async function fetchJupiterInfo(mints: string[]): Promise<Record<string, JupiterInfo>> {
  if (mints.length === 0) return {};
  try {
    const r = await fetch(`/api/tokens/jupiter?mints=${mints.join(",")}`);
    const json = (await r.json()) as { tokens?: Array<{ mint: string } & JupiterInfo> };
    const out: Record<string, JupiterInfo> = {};
    for (const t of json.tokens ?? []) out[t.mint] = { symbol: t.symbol, name: t.name, icon: t.icon, usdPrice: t.usdPrice, change24h: t.change24h ?? null };
    return out;
  } catch {
    return {};
  }
}

async function fetchMeta(mint: string, rpc: string): Promise<Meta> {
  // On-chain fallback for tokens Jupiter does not list.
  const known = KNOWN[mint];
  const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } }),
    });
    const item = (await r.json())?.result;
    const symbol = item?.token_info?.symbol || item?.content?.metadata?.symbol;
    const name = item?.content?.metadata?.name;
    return { symbol: known?.symbol ?? symbol ?? short, name: known?.name ?? name ?? symbol ?? short };
  } catch {
    return { symbol: known?.symbol ?? short, name: known?.name ?? short };
  }
}

/**
 * Everything the user's Loofta Solana wallet holds: native SOL plus every SPL token with a balance.
 * Priced in USD where a price feed has the token; unpriced tokens are still listed and sendable.
 */
export function useWalletHoldings() {
  const { user, authenticated } = usePrivy();
  const networkMode = useAuthStore((s) => s.networkMode);
  const address = deriveSolanaEmbeddedAddress(user ?? null);
  const solPrice = useSolPriceOrNull();
  const rpc = getRpcForMode(networkMode);

  const query = useQuery({
    queryKey: ["walletHoldings", address, networkMode],
    enabled: authenticated === true && !!address,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const conn = new Connection(rpc, "confirmed");
      const [lamports, rows] = await Promise.all([conn.getBalance(new PublicKey(address as string)), fetchTokenRows(address as string, rpc)]);
      const mints = [SOL_MINT, ...rows.map((r) => r.mint)];
      const jup = networkMode === "mainnet" ? await fetchJupiterInfo(mints) : {};
      // Only tokens Jupiter does not know fall back to on-chain metadata.
      const metas = await Promise.all(rows.map((r) => (jup[r.mint]?.symbol ? Promise.resolve<Meta>({ symbol: "", name: "" }) : fetchMeta(r.mint, rpc))));
      return { sol: lamports / 1e9, rows, jup, metas };
    },
  });

  const data = query.data;
  const holdings: WalletHolding[] = [];
  if (data) {
    holdings.push({
      id: "sol",
      mint: null,
      symbol: "SOL",
      name: "Solana",
      chain: "Solana",
      decimals: 9,
      amount: data.sol,
      usd: (data.jup[SOL_MINT]?.usdPrice ?? solPrice) != null ? data.sol * ((data.jup[SOL_MINT]?.usdPrice ?? solPrice) as number) : null,
      change24h: data.jup[SOL_MINT]?.change24h ?? null,
      logo: data.jup[SOL_MINT]?.icon ?? undefined,
    });
    data.rows.forEach((r, i) => {
      const j = data.jup[r.mint];
      const meta = data.metas[i];
      const known = KNOWN[r.mint];
      holdings.push({
        id: r.mint,
        mint: r.mint,
        symbol: known?.symbol ?? j?.symbol ?? meta.symbol,
        name: known?.name ?? j?.name ?? meta.name,
        chain: "Solana",
        decimals: r.decimals,
        amount: r.amount,
        usd: j?.usdPrice != null ? r.amount * j.usdPrice : null,
        change24h: j?.change24h ?? null,
        logo: j?.icon ?? undefined,
      });
    });
  }
  holdings.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));

  const totalUsd = holdings.reduce((a, h) => a + (h.usd ?? 0), 0);
  // Portfolio move over 24h at today's holdings: each token's value a day ago is value / (1 + change).
  let before = 0;
  let now = 0;
  for (const x of holdings) {
    if (x.usd == null || x.change24h == null || x.change24h <= -100) continue;
    now += x.usd;
    before += x.usd / (1 + x.change24h / 100);
  }
  const change24hPct = before > 0 ? ((now - before) / before) * 100 : null;
  const change24hUsd = before > 0 ? now - before : null;
  const unpriced = holdings.some((h) => h.usd == null && h.amount > 0);

  const linked = ((user as { linkedAccounts?: unknown } | null)?.linkedAccounts ?? []) as Array<{
    type?: string;
    address?: string;
    chainType?: string;
    walletClientType?: string;
  }>;
  const evmAddress =
    linked.find((a) => a.type === "wallet" && a.chainType === "ethereum" && a.walletClientType === "privy")?.address ??
    linked.find((a) => a.type === "wallet" && a.chainType === "ethereum")?.address ??
    null;

  return {
    holdings,
    totalUsd,
    change24hPct,
    change24hUsd,
    unpriced,
    isLoading: query.isLoading,
    refetch: query.refetch,
    address,
    evmAddress,
    solMint: SOL_MINT,
  };
}
