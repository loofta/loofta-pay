import { NEAR_INTENTS_ENDPOINTS, NEAR_INTENTS_TEST_MODE, NEAR_INTENTS_REMOTE_BASE } from "@/config/nearIntents";
import defaults from "@/config/defaultTokens.json";
// Prefer official SDK APIs per near-intents-examples
// https://github.com/defuse-protocol/near-intents-examples
// Example: import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript'

export type NearToken = {
  symbol: string;
  name: string;
  chain: string;
  address: string;
  tokenId?: string;
  decimals: number;
  logoURI?: string;
};

// Dynamic import so build doesn't fail if package missing at first
let OneClickServiceRef: any | null = null;
// Basic local fallbacks; will be overridden by CoinMarketCap resolver when possible
const TOKEN_LOGOS: Record<string, string> = {
  ETH: "/images/eth.png",
  SOL: "/images/solana.png",
  USDT: "/usdt.svg",
  USDC: "/usdt.svg",
  NEAR: "/images/eth.png",
};
// Minimal CMC ID map for common assets; extend as needed
const CMC_IDS: Record<string, number> = {
  BTC: 1,
  ETH: 1027,
  USDT: 825,
  USDC: 3408,
  SOL: 5426,
  NEAR: 6535,
  TON: 11419,
  TONCOIN: 11419,
};
function cmcLogo(symbol?: string): string | undefined {
  const id = symbol ? CMC_IDS[symbol.toUpperCase()] : undefined;
  return id ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png` : undefined;
}
async function loadOneClickService(): Promise<any | null> {
  if (OneClickServiceRef) return OneClickServiceRef;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - rely on runtime presence after install
    const m: any = await import('@defuse-protocol/one-click-sdk-typescript');
    OneClickServiceRef = m?.OneClickService || m?.default || null;
    // Configure base URL if SDK exposes a setter (keep compatibility if not)
    if (OneClickServiceRef?.setConfig) {
      OneClickServiceRef.setConfig({
        baseUrl: NEAR_INTENTS_REMOTE_BASE,
        mode: NEAR_INTENTS_TEST_MODE ? 'test' : 'prod',
      });
    }
    return OneClickServiceRef;
  } catch {
    return null;
  }
}

function mapSdkToken(t: any): NearToken {
  // Example token fields per example repo:
  // { blockchain, symbol, assetId, contractAddress }
  const symbol = t?.symbol || '';
  return {
    symbol,
    name: symbol || '',
    chain: t?.blockchain || t?.chain || '',
    address: t?.assetId || t?.contractAddress || '',
    tokenId: t?.assetId || t?.tokenId || t?.address,
    decimals: typeof t?.decimals === 'number' ? t.decimals : 0,
    logoURI: t?.logoURI || cmcLogo(symbol) || TOKEN_LOGOS[symbol] || undefined,
  };
}

export async function fetchTokens(): Promise<NearToken[]> {
  // Prefer SDK (static service) if available
  const OneClickService = await loadOneClickService();
  try {
    if (OneClickService?.getTokens) {
      const r = await OneClickService.getTokens();
      const arr = Array.isArray(r) ? r : (r?.tokens || []);
      return arr.map(mapSdkToken);
    }
  } catch {
    // fall through to proxy
  }
  try {
    const res = await fetch(NEAR_INTENTS_ENDPOINTS.tokens, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch tokens: ${res.status}`);
    const data = await res.json();
    // Expecting an array of tokens compatible with NearToken
    const arr = (data?.tokens || data || []) as any[];
    return arr.map(rt => {
      const symbol = rt?.symbol || '';
      return {
        ...(rt as any),
        tokenId: rt?.assetId || rt?.tokenId || rt?.address,
        logoURI: rt?.logoURI || cmcLogo(symbol) || TOKEN_LOGOS[symbol] || rt?.logo || undefined,
      } as NearToken;
    });
  } catch (_) {
    // Fallback to defaults if remote fails
    return defaults as NearToken[];
  }
}

export async function searchTokens(query: string): Promise<NearToken[]> {
  const q = (query || "").trim();
  // If empty query, return full list (or defaults)
  if (!q) return fetchTokens();
  // Try SDK first: many SDKs only expose list; filter locally
  const OneClickService = await loadOneClickService();
  try {
    if (OneClickService?.getTokens) {
      const r = await OneClickService.getTokens();
      const arr: NearToken[] = (Array.isArray(r) ? r : (r?.tokens || [])).map(mapSdkToken);
      const lc = q.toLowerCase();
      return arr.filter(t =>
        t.symbol.toLowerCase().includes(lc) ||
        t.name.toLowerCase().includes(lc) ||
        t.chain.toLowerCase().includes(lc)
      );
    }
  } catch {
    // fall back to proxy/local
  }
  try {
    const url = `${NEAR_INTENTS_ENDPOINTS.tokens}?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to search tokens: ${res.status}`);
    const data = await res.json();
    return (data?.tokens || data || []) as NearToken[];
  } catch {
    // Fallback: filter locally from full list
    const all = await fetchTokens();
    const lc = q.toLowerCase();
    return all.filter(t =>
      t.symbol.toLowerCase().includes(lc) ||
      t.name.toLowerCase().includes(lc) ||
      t.chain.toLowerCase().includes(lc)
    );
  }
}

export type CreateIntentInput = {
  fromToken: NearToken;
  toToken: NearToken;
  amount: string; // human-readable amount
  referralCode?: string;
};

export type CreateIntentResponse = {
  id: string;
  status: string;
  summary?: any;
};

export async function createTestIntent(input: CreateIntentInput): Promise<CreateIntentResponse> {
  // Try SDK first (shape unknown, handle common variants)
  const OneClickService = await loadOneClickService();
  try {
    const payload = {
      mode: NEAR_INTENTS_TEST_MODE ? "test" : "prod",
      request: {
        kind: "swap",
        from: {
          chain: input.fromToken.chain,
          token: input.fromToken.tokenId || input.fromToken.address,
          amount: input.amount,
          decimals: input.fromToken.decimals,
        },
        to: {
          chain: input.toToken.chain,
          token: input.toToken.tokenId || input.toToken.address,
        },
        referralCode: input.referralCode || undefined,
      },
    };
    if (OneClickService?.createIntent) {
      const r = await OneClickService.createIntent(payload);
      return r as CreateIntentResponse;
    }
  } catch {
    // Fall through to proxy fetch
  }
  const body = {
    mode: NEAR_INTENTS_TEST_MODE ? "test" : "prod",
    request: {
      kind: "swap",
      from: {
        chain: input.fromToken.chain,
        token: input.fromToken.address,
        amount: input.amount,
        decimals: input.fromToken.decimals,
      },
      to: {
        chain: input.toToken.chain,
        token: input.toToken.address,
      },
      referralCode: input.referralCode || undefined,
    },
  };

  const res = await fetch(NEAR_INTENTS_ENDPOINTS.intents, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to create intent: ${res.status} ${text}`);
  }
  return (await res.json()) as CreateIntentResponse;
}


