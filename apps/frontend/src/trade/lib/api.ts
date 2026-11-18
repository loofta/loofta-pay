/** Calls the Nest backend through the same-origin /api/backend proxy, never directly. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = (data as { message?: string | string[] } | null)?.message;
    throw new Error(Array.isArray(msg) ? msg.join(", ") : msg || `Request failed (${res.status})`);
  }
  return data as T;
}

export type SwapParams = { inputMint: string; outputMint: string; amount: string; slippageBps?: number };

export type SwapQuote = {
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  feeBps: number;
  feeAmount: string;
  priceImpactPct: number;
  needsAccountRent: boolean;
  gasless: boolean;
  inDecimals: number;
  outDecimals: number;
};

export type SwapBuild = {
  gasless: boolean;
  id?: string;
  swapTransaction: string;
  outAmount: string;
  outDecimals: number;
  feeBps: number;
  /** Set when the backend tracks this trade for rewards. Sponsored swaps are counted by the backend itself. */
  tradeId?: string | null;
};

export const quoteSwap = (p: SwapParams, token: string | null, signal?: AbortSignal) =>
  api<SwapQuote>("/jupiter/swap/quote", { body: p, token, signal });

export const buildSwap = (p: SwapParams, token: string | null) => api<SwapBuild>("/jupiter/swap/build", { body: p, token });

/** Coins still on the Pump bonding curve trade against Pump's own program. SOL goes in on a buy and comes out on a sell. */
export type PumpParams = { mint: string; side: "buy" | "sell"; amount: string; slippageBps?: number };
export const quotePump = (p: PumpParams, token: string | null, signal?: AbortSignal) => api<SwapQuote>("/pump/quote", { body: p, token, signal });
export const buildPump = (p: PumpParams, token: string | null) => api<SwapBuild>("/pump/build", { body: p, token });
/** The backend answers with this prefix when a coin cannot trade on the curve, so the app uses Jupiter instead. */
export const PUMP_UNSUPPORTED = "PUMP_UNSUPPORTED";

export const submitSwap =(p: { id: string; signedTransaction: string }, token: string | null) =>
  api<{ signature: string }>("/jupiter/swap/submit", { body: p, token });
