import { clientApiBase } from '@/services/api/client';

const FETCH_TIMEOUT_MS = 8_000;

export interface UsdcNgnRateSnapshot {
  /** USDC price in USD, from CoinGecko. Null if that source failed. */
  usdcUsd: number | null;
  /** Official/interbank USD->NGN reference rate — the closest free live proxy for "bank rate". Null if that source failed. */
  bankRateNgn: number | null;
  /** PAJ Cash's live USDC->NGN off-ramp rate — what a Loofta recipient actually gets. Null if that source failed. */
  looftaRateNgn: number | null;
  updatedAt: string;
}

async function fetchCoinGeckoUsdcUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd', {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const value = data?.['usd-coin']?.usd;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function fetchBankRateNgn(): Promise<number | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const value = data?.rates?.NGN;
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function fetchLooftaRateNgn(): Promise<number | null> {
  try {
    const res = await fetch(`${clientApiBase()}/paj-cash/public-rate`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.rate === 'number' ? data.rate : null;
  } catch {
    return null;
  }
}

/** Always hits live sources — no caching. Rate quotes must stay fresh since real
 * on/off-ramp amounts are derived from the same PAJ rate elsewhere in the app. */
export async function getUsdcNgnRateSnapshot(): Promise<UsdcNgnRateSnapshot> {
  const [usdcUsd, bankRateNgn, looftaRateNgn] = await Promise.all([
    fetchCoinGeckoUsdcUsd(),
    fetchBankRateNgn(),
    fetchLooftaRateNgn(),
  ]);

  return {
    usdcUsd,
    bankRateNgn,
    looftaRateNgn,
    updatedAt: new Date().toISOString(),
  };
}
