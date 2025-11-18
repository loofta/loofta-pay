import { NEAR_INTENTS_TEST_MODE } from "@/config/nearIntents";
import defaults from "@/config/defaultTokens.json";
// Prefer official SDK APIs per near-intents-examples
// https://github.com/defuse-protocol/near-intents-examples
import { OneClickService, QuoteRequest, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript';
import { ONECLICK_API_BASE } from "@/config/oneClick";

export type NearToken = {
  symbol: string;
  name: string;
  chain: string;
  address: string;
  tokenId?: string;
  decimals: number;
  logoURI?: string;
  price?: number;
  priceUpdatedAt?: string;
};

import { resolveTokenLogo } from "@/lib/tokenImages";
import { getDefuseAssetIdFor, getIconForAssetId } from "@/lib/tokenlist";

// Configure SDK base/token once
// Match 1-click examples: https://1click.chaindefuser.com
OpenAPI.BASE = ONECLICK_API_BASE;
if (typeof process !== "undefined" && (process as any).env?.NEXT_PUBLIC_ONECLICK_JWT) {
  OpenAPI.TOKEN = (process as any).env.NEXT_PUBLIC_ONECLICK_JWT;
}

function mapSdkToken(t: any): NearToken {
  // Match intents-swap-widget shape: prefer backend icon, chain lowercase, use assetId
  const symbol = t?.symbol || '';
  const assetId = t?.assetId || t?.tokenId || t?.address;
  const blockchain = typeof t?.blockchain === 'string' ? t.blockchain.toLowerCase() : (t?.chain || '');
  const preferredIcon = typeof t?.icon === 'string' ? t.icon : getIconForAssetId(assetId);
  return {
    symbol,
    name: symbol || '',
    chain: blockchain || '',
    address: t?.assetId || t?.contractAddress || '',
    tokenId: assetId || getDefuseAssetIdFor(symbol, blockchain),
    decimals: typeof t?.decimals === 'number' ? t.decimals : 0,
    logoURI: preferredIcon || resolveTokenLogo({ symbol, logoURI: t?.logoURI, icon: preferredIcon, logo: t?.logo }),
    price: typeof t?.price === 'number' ? t.price : undefined,
    priceUpdatedAt: typeof t?.priceUpdatedAt === 'string' ? t.priceUpdatedAt : undefined,
  };
}

export async function fetchTokens(): Promise<NearToken[]> {
  // SDK getTokens (matches 1-get-tokens.ts)
  const r: any = await OneClickService.getTokens();
  const arr = Array.isArray(r) ? r : (r?.tokens || []);
  if (Array.isArray(arr) && arr.length) {
    const mapped = arr.map(mapSdkToken).filter((t) => t.symbol && t.tokenId && t.chain);
    return mapped;
  }
  // Fallback to defaults if SDK not available
  return (defaults as any[]).map((rt: any) => {
    const symbol = rt?.symbol || '';
    return {
      ...(rt as any),
      tokenId: rt?.assetId || rt?.tokenId || rt?.address || getDefuseAssetIdFor(symbol, rt?.blockchain || rt?.chain),
      price: undefined,
      priceUpdatedAt: undefined,
      logoURI: resolveTokenLogo({ symbol, logoURI: rt?.logoURI, icon: rt?.icon, logo: rt?.logo }),
    } as NearToken;
  });
}

export async function searchTokens(query: string): Promise<NearToken[]> {
  const q = (query || "").trim();
  // If empty query, return full list (or defaults)
  if (!q) return fetchTokens();
  const r: any = await OneClickService.getTokens();
  const arr: NearToken[] = (Array.isArray(r) ? r : (r?.tokens || [])).map(mapSdkToken);
  const lc = q.toLowerCase();
  if (arr?.length) {
    return arr.filter(t =>
      t.symbol.toLowerCase().includes(lc) ||
      t.name.toLowerCase().includes(lc) ||
      t.chain.toLowerCase().includes(lc)
    );
  }
  // Fallback: filter locally from full list
  const all = await fetchTokens();
  const lcLocal = q.toLowerCase();
  return all.filter(t =>
    t.symbol.toLowerCase().includes(lcLocal) ||
    t.name.toLowerCase().includes(lcLocal) ||
    t.chain.toLowerCase().includes(lcLocal)
  );
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
  const r = await (OneClickService as any).createIntent(payload as any);
  return r as CreateIntentResponse;
}

// Lightweight quote helper (EXACT_INPUT), amount in human string -> atomic for origin token
export type QuoteResponse = {
  raw: any;
  amountOut?: string; // human-readable amount for destination token when available
  error?: {
    type: "client" | "server" | "network" | "unknown";
    status?: number;
    message?: string;
    correlationId?: string;
  };
};

export type AuthMethod = "near" | "evm" | "solana" | "webauthn" | "ton" | "stellar" | "tron";

export type DepositInfo = {
  raw: any;
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  timeEstimate?: number;
  timeWhenInactive?: string;
  quoteId?: string;
  originAsset?: string;
  destinationAsset?: string;
  amountAtomic?: string; // amount to send in atomic units for origin asset
};

export async function getAccurateQuote(params: {
  fromToken: NearToken;
  toToken: NearToken;
  amount: string; // human-readable input amount
  recipient?: string;
  sender?: string;
  slippageBps?: number; // default 100 = 1%
  dryRun?: boolean; // default true for quick quote
  userAddress?: string; // optional; when provided with authMethod, uses INTENTS routing
  authMethod?: AuthMethod;
}): Promise<QuoteResponse> {
  const { fromToken, toToken, amount, recipient, sender, slippageBps = 100, dryRun = true, userAddress, authMethod } = params;
  const toAtomic = (val: string, decimals: number): string => {
    const [i, f = ""] = String(val).split(".");
    const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
    const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
    // remove leading zeros
    return BigInt(padded).toString();
  };
  const originAsset = fromToken.tokenId || fromToken.address;
  const destinationAsset = toToken.tokenId || toToken.address;
  const atomicIn = toAtomic(amount || "0", fromToken.decimals || 0);
  try {
    let req: QuoteRequest;
    if (userAddress && authMethod) {
      // Use INTENTS identity mapping (authMethod:userAddress)
      const intentsUserId = `${authMethod.toLowerCase()}:${userAddress}`;
      req = {
        dry: dryRun,
        swapType: QuoteRequest.swapType.EXACT_INPUT,
        slippageTolerance: slippageBps,
        originAsset,
        depositType: QuoteRequest.depositType.INTENTS,
        destinationAsset,
        amount: atomicIn,
        refundTo: intentsUserId,
        refundType: QuoteRequest.refundType.INTENTS,
        recipient: intentsUserId,
        recipientType: QuoteRequest.recipientType.INTENTS,
        deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        quoteWaitingTimeMs: 0,
      };
    } else {
      // Fallback path without authMethod: for dry quotes, align with intents-swap-widget to avoid KYT
      if (dryRun) {
        const ZERO = "0x0000000000000000000000000000000000000000";
        const getDryQuoteAddress = (blockchain: string): string => {
          const key = String(blockchain || "").toLowerCase();
          const evmSet = new Set([
            "eth",
            "bera",
            "base",
            "gnosis",
            "arb",
            "bsc",
            "avax",
            "op",
            "pol",
            "polygon",
          ]);
          if (key === "near") return "system.near";
          if (key === "sol" || key === "solana")
            return "11111111111111111111111111111111";
          if (evmSet.has(key)) return ZERO;
          // default to evm zero
          return ZERO;
        };
        const recipientDry = getDryQuoteAddress(toToken.chain);
        const refundDry = getDryQuoteAddress(fromToken.chain);
        req = {
          dry: true,
          swapType: QuoteRequest.swapType.EXACT_INPUT,
          slippageTolerance: slippageBps,
          originAsset,
          depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
          destinationAsset,
          amount: atomicIn,
          refundTo: refundDry,
          refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
          recipient: recipientDry,
          recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
          deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
          quoteWaitingTimeMs: 3000,
        } as QuoteRequest;
        // Add referral like the widget payload (SDK types may not include it)
        (req as any).referral = "unknown";
      } else {
        // Non-dry requires concrete chain addressing
        if (!sender || !recipient) {
          throw new Error("Missing sender/recipient for ORIGIN_CHAIN quote");
        }
        req = {
          dry: false,
          swapType: QuoteRequest.swapType.EXACT_INPUT,
          slippageTolerance: slippageBps,
          originAsset,
          depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
          destinationAsset,
          amount: atomicIn,
          refundTo: sender,
          refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
          recipient: recipient,
          recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
          deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
          quoteWaitingTimeMs: 3000,
        };
      }
    }
    const raw = await OneClickService.getQuote(req);
    const q = (raw as any)?.quote || raw;
    const humanOut = q?.amountOutFormatted
      ? String(q.amountOutFormatted)
      : (typeof q?.amountOut === "string" && toToken.decimals != null
          ? (Number(q.amountOut) / Math.pow(10, toToken.decimals)).toString()
          : undefined);
    return { raw, amountOut: humanOut };
  } catch (_e: any) {
    // Build an error typology from SDK/axios error shapes
    const err = _e || {};
    const status: number | undefined = err?.status ?? err?.response?.status;
    const data = err?.body ?? err?.response?.data;
    const message: string | undefined = data?.message || err?.message;
    const correlationId: string | undefined = data?.correlationId;
    let type: "client" | "server" | "network" | "unknown" = "unknown";
    if (typeof status === "number") {
      if (status >= 400 && status < 500) type = "client";
      else if (status >= 500) type = "server";
    } else if (err?.code === "ERR_NETWORK" || message?.toLowerCase().includes("network")) {
      type = "network";
    }
    // Fallback: compute via prices if available, but attach error
    const pIn = typeof fromToken.price === "number" ? fromToken.price : undefined;
    const pOut = typeof toToken.price === "number" ? toToken.price : undefined;
    if (pIn && pOut && pOut > 0) {
      const n = Number(amount || 0);
      if (Number.isFinite(n)) {
        return {
          raw: null,
          amountOut: ((n * pIn) / pOut).toString(),
          error: { type, status, message, correlationId },
        };
      }
    }
    return { raw: null, amountOut: undefined, error: { type, status, message, correlationId } };
  }
}

// Request a non-dry quote to obtain deposit instructions (address, deadline, etc.)
export async function getDepositInfo(params: {
  fromToken: NearToken;
  toToken: NearToken;
  amount: string; // human-readable input amount
  recipient?: string;
  sender?: string;
  slippageBps?: number; // default 100 = 1%
  userAddress?: string;
  authMethod?: AuthMethod;
}): Promise<DepositInfo> {
  const { fromToken, toToken, amount, recipient, sender, slippageBps = 100, userAddress, authMethod } = params;
  const toAtomic = (val: string, decimals: number): string => {
    const [i, f = ""] = String(val).split(".");
    const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
    const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
    return BigInt(padded).toString();
  };
  const originAsset = fromToken.tokenId || fromToken.address;
  const destinationAsset = toToken.tokenId || toToken.address;
  const atomicIn = toAtomic(amount || "0", fromToken.decimals || 0);
  let req: QuoteRequest;
  if (userAddress && authMethod) {
    const intentsUserId = `${authMethod.toLowerCase()}:${userAddress}`;
    req = {
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: slippageBps,
      originAsset,
      depositType: QuoteRequest.depositType.INTENTS,
      destinationAsset,
      amount: atomicIn,
      refundTo: intentsUserId,
      refundType: QuoteRequest.refundType.INTENTS,
      recipient: intentsUserId,
      recipientType: QuoteRequest.recipientType.INTENTS,
      deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 0,
    };
  } else {
    if (!sender || !recipient) {
      throw new Error("Missing sender/recipient for ORIGIN_CHAIN deposit quote");
    }
    req = {
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: slippageBps,
      originAsset,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      destinationAsset,
      amount: atomicIn,
      refundTo: sender,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: recipient,
      recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
      deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
    };
  }
  const raw = await OneClickService.getQuote(req);
  const q = (raw as any)?.quote || raw || {};
  return {
    raw,
    depositAddress: q?.depositAddress || q?.address,
    memo: q?.memo ?? null,
    deadline: q?.deadline,
    timeEstimate: q?.timeEstimate,
    timeWhenInactive: q?.timeWhenInactive,
    quoteId: q?.id || q?.quoteId,
    originAsset,
    destinationAsset,
    amountAtomic: atomicIn,
  };
}

// SDK-style names to mirror 1click examples
export const getTokens = fetchTokens;
export const getQuote = getAccurateQuote;


