/* eslint-disable */
/**
 * Live market cap for Pump coins straight from their bonding curve account on Solana. No paid data provider: one
 * getMultipleAccounts call covers up to 100 coins, and every account holds the curve's reserves, so price and market cap
 * follow from them exactly as Pump itself computes them. Also tells us when a coin has graduated (the curve is complete).
 *
 * Results are kept a few seconds and shared by every request, and a coin is only re-read when its copy is stale.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_SDK, bondingCurvePda, bondingCurveMarketCap } from "@pump-fun/pump-sdk";
import { getMainnetSolanaRpcUrl } from "@/common/solana-cluster-env";

export interface CurveSnapshot {
  /** Market cap in SOL, from the curve's own reserves. */
  mcapSol: number;
  /** True once the curve is complete and the coin has moved to the open market. */
  complete: boolean;
}

const WSOL = "So11111111111111111111111111111111111111112";
const TTL_MS = 3_000;
const BATCH = 100;
const MAX_CACHED = 1_500;

const cache = new Map<string, { at: number; snap: CurveSnapshot | null }>();
let conn: Connection | null = null;
const connection = () => (conn ??= new Connection(getMainnetSolanaRpcUrl({ get: () => undefined } as never), "confirmed"));
let inflight: Promise<void> | null = null;

async function refresh(mints: string[]) {
  for (let i = 0; i < mints.length; i += BATCH) {
    const chunk = mints.slice(i, i + BATCH);
    try {
      const infos = await connection().getMultipleAccountsInfo(chunk.map((m) => bondingCurvePda(new PublicKey(m))));
      const at = Date.now();
      chunk.forEach((m, k) => {
        const info = infos[k];
        if (!info) return cache.set(m, { at, snap: null });
        try {
          const c = PUMP_SDK.decodeBondingCurve(info);
          // Reserves are in the quote token. Only SOL-quoted curves can be turned into a SOL market cap here.
          const q = c.quoteMint?.toBase58?.();
          if (q && q !== WSOL && q !== PublicKey.default.toBase58()) return cache.set(m, { at, snap: null });
          const lamports = bondingCurveMarketCap({ mintSupply: c.tokenTotalSupply, virtualQuoteReserves: c.virtualQuoteReserves, virtualTokenReserves: c.virtualTokenReserves });
          cache.set(m, { at, snap: { mcapSol: Number(lamports.toString()) / 1e9, complete: c.complete } });
        } catch {
          cache.set(m, { at, snap: null });
        }
      });
    } catch (e) {
      console.warn(`[curve] read failed: ${(e as Error)?.message ?? e}`);
    }
  }
  if (cache.size > MAX_CACHED) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - MAX_CACHED);
    for (const [k] of oldest) cache.delete(k);
  }
}

/** Snapshots for the given coins. Stale ones are re-read together in one batch, and concurrent callers share that read. */
export async function curveSnapshots(mints: string[]): Promise<Map<string, CurveSnapshot>> {
  const now = Date.now();
  const stale = mints.filter((m) => now - (cache.get(m)?.at ?? 0) > TTL_MS);
  if (stale.length > 0) {
    if (!inflight) inflight = refresh(stale).finally(() => (inflight = null));
    await inflight;
  }
  const out = new Map<string, CurveSnapshot>();
  for (const m of mints) {
    const s = cache.get(m)?.snap;
    if (s) out.set(m, s);
  }
  return out;
}
