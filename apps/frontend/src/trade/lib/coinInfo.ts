import { useEffect, useState } from "react";

export type CoinInfoData = {
  found: boolean;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  change24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  athUsd: number | null;
  athChangePct: number | null;
  rank: number | null;
  createdAt: number | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
};

const CACHE = new Map<string, { at: number; data: CoinInfoData }>();

/** Details for a coin (volume, liquidity, supply, links). Kept 10 minutes so reopening a coin does not ask again. */
export function useCoinInfo(mint: string | null): CoinInfoData | null | undefined {
  const [d, setD] = useState<CoinInfoData | null | undefined>(() => (mint ? CACHE.get(mint)?.data : undefined));
  useEffect(() => {
    if (!mint) return;
    const hit = CACHE.get(mint);
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      setD(hit.data);
      return;
    }
    let alive = true;
    setD(undefined);
    fetch(`/api/backend/mini/info?mint=${encodeURIComponent(mint)}`)
      .then((r) => r.json())
      .then((j: CoinInfoData) => {
        CACHE.set(mint, { at: Date.now(), data: j });
        if (alive) setD(j);
      })
      .catch(() => alive && setD(null));
    return () => {
      alive = false;
    };
  }, [mint]);
  return d;
}
