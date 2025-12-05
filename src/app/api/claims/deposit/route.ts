'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { getRefundToForChain } from "@/lib/refundAddresses";

function getEnv(name: string, fallbacks: string[] = []) {
  const all = [name, ...fallbacks];
  for (const n of all) {
    const v = (process as any).env?.[n];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

const ONECLICK_BASE = getEnv("ONECLICK_API_BASE", ["NEXT_PUBLIC_ONECLICK_API_BASE"]) || "https://1click.chaindefuser.com";
const ONECLICK_JWT = getEnv("ONECLICK_JWT", ["NEXT_PUBLIC_ONECLICK_JWT"]);
OpenAPI.BASE = ONECLICK_BASE;
if (ONECLICK_JWT) OpenAPI.TOKEN = ONECLICK_JWT;

// Chains that require INTENTS deposit mode (non-native chains that go through Near intents)
const INTENTS_ONLY_CHAINS = new Set(['zec', 'zcash', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar', 'ada', 'cardano', 'ltc', 'litecoin', 'doge', 'dogecoin']);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { claimId, fromToken, amount, userAddress } = body || {};
    if (!claimId || !fromToken?.tokenId || !fromToken?.decimals || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: claim, error } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain, recipient_address")
      .eq("id", claimId)
      .single();
    if (error || !claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ""] = String(val).split(".");
      const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
      return BigInt(padded).toString();
    };
    const atomicIn = toAtomic(String(amount || "0"), Number(fromToken.decimals));

    // Destination asset id from claim row (matches 1Click nep141:<chain>.omft.near style in your schema)
    const destinationAsset = claim.to_symbol && claim.to_chain ? `nep141:${claim.to_chain}.omft.near` : "";
    
    // Check if origin chain requires INTENTS mode
    const originChain = String(fromToken?.chain || "").toLowerCase();
    const useIntentsMode = INTENTS_ONLY_CHAINS.has(originChain);
    
    // Determine same-chain and choose recipient type accordingly
    const sameChain = originChain === String(claim.to_chain || "").toLowerCase();
    
    // For EXACT_OUTPUT we need destination token decimals to convert human -> atomic
    let destDecimals = 6;
    let destPrice: number | undefined = undefined;
    try {
      const tokens: any = await (OneClickService as any).getTokens();
      const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
      const found = arr.find((t: any) => String(t?.assetId || t?.tokenId || "").toLowerCase() === String(destinationAsset).toLowerCase());
      if (found && typeof found.decimals === "number") destDecimals = found.decimals;
      if (found && typeof found.price === "number") destPrice = found.price;
    } catch {}
    // amount on claim is stored in USD, convert to destination token using price
    const amountUsd = Number(claim.amount || 0);
    const destHumanOut = (Number.isFinite(amountUsd) && typeof destPrice === "number" && destPrice > 0)
      ? (amountUsd / destPrice)
      : 0;
    // Round up to 6 decimals to avoid under-paying due to rounding
    const destHumanOutRoundedUp = (() => {
      const factor = Math.pow(10, 6);
      return Math.ceil(destHumanOut * factor) / factor;
    })();
    const amountOutAtomic = toAtomic(String(destHumanOutRoundedUp || "0"), destDecimals);
    
    // Get appropriate refund address for the origin chain
    const refundAddress = getRefundToForChain(originChain);
    
    // For intents mode, calculate input amount in origin token atomic units
    // We need to estimate how much ZEC/BTC etc. to send to get the desired output
    let originDecimals = Number(fromToken.decimals) || 8;
    let originPrice: number | undefined = undefined;
    try {
      const tokens: any = await (OneClickService as any).getTokens();
      const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
      const foundOrigin = arr.find((t: any) => String(t?.assetId || t?.tokenId || "").toLowerCase() === String(fromToken.tokenId).toLowerCase());
      if (foundOrigin && typeof foundOrigin.decimals === "number") originDecimals = foundOrigin.decimals;
      if (foundOrigin && typeof foundOrigin.price === "number") originPrice = foundOrigin.price;
    } catch {}
    
    // For intents mode with EXACT_INPUT, calculate how much origin token to send
    const amountInHuman = (Number.isFinite(amountUsd) && typeof originPrice === "number" && originPrice > 0)
      ? (amountUsd / originPrice)
      : 0;
    // Add 2% buffer for slippage
    const amountInWithBuffer = amountInHuman * 1.02;
    const amountInAtomic = toAtomic(String(amountInWithBuffer || "0"), originDecimals);
    
    // Build request based on deposit mode
    const req: QuoteRequest = useIntentsMode ? {
      // INTENTS mode - use EXACT_INPUT like near-intents does
      dry: false,
      swapType: "EXACT_INPUT" as any,
      slippageTolerance: 100,
      originAsset: fromToken.tokenId,
      depositType: "INTENTS" as any,
      destinationAsset,
      amount: amountInAtomic,
      refundTo: userAddress || refundAddress,
      refundType: "INTENTS" as any,
      recipient: userAddress || claim.recipient_address,
      recipientType: "INTENTS" as any,
      deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
      ...(userAddress ? { authMethod: "evm", userAddress } : {}),
    } as any : {
      // Regular mode - use EXACT_OUTPUT
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_OUTPUT,
      slippageTolerance: 100,
      originAsset: fromToken.tokenId,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      destinationAsset,
      amount: amountOutAtomic,
      refundTo: refundAddress,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: claim.recipient_address,
      recipientType: sameChain ? (QuoteRequest.recipientType as any).ORIGIN_CHAIN : QuoteRequest.recipientType.DESTINATION_CHAIN,
      deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
    } as any;

    // Debug log (visible in server logs)
    console.log("[claims/deposit] === FULL REQUEST ===");
    console.log("[claims/deposit] Input:", { claimId, fromToken, amount, userAddress });
    console.log("[claims/deposit] Claim:", claim);
    console.log("[claims/deposit] useIntentsMode:", useIntentsMode);
    console.log("[claims/deposit] destinationAsset:", destinationAsset);
    console.log("[claims/deposit] destDecimals:", destDecimals);
    console.log("[claims/deposit] destPrice:", destPrice);
    console.log("[claims/deposit] amountOutAtomic:", amountOutAtomic);
    console.log("[claims/deposit] originDecimals:", originDecimals);
    console.log("[claims/deposit] originPrice:", originPrice);
    console.log("[claims/deposit] amountInHuman:", amountInHuman);
    console.log("[claims/deposit] amountInAtomic:", amountInAtomic);
    console.log("[claims/deposit] Full quoteRequest:", JSON.stringify(req, null, 2));
    
    let raw: any;
    try {
      raw = await OneClickService.getQuote(req);
      console.log("[claims/deposit] Quote response:", JSON.stringify(raw, null, 2));
    } catch (quoteError: any) {
      console.error("[claims/deposit] Quote ERROR:", quoteError?.message || quoteError);
      console.error("[claims/deposit] Quote ERROR body:", quoteError?.body || quoteError?.response);
      throw quoteError;
    }
    const q = (raw as any)?.quote || raw || {};

    // Upsert claim_intents with deposit info
    try {
      const ins = await supabase
        .from("claim_intents")
        .insert({
          claim_id: claimId,
          quote_id: q?.id || q?.quoteId || null,
          deposit_address: q?.depositAddress || q?.address || null,
          memo: q?.memo ?? null,
          deadline: q?.deadline ? new Date(q.deadline).toISOString() : null,
          time_estimate: typeof q?.timeEstimate === "number" ? q.timeEstimate : null,
          status: "PENDING_DEPOSIT",
          last_status_payload: null,
        })
        .select("id")
        .single();
      // Also set parent claim status to PENDING_DEPOSIT
      await supabase.from("claims").update({ status: "PENDING_DEPOSIT" }).eq("id", claimId);
    } catch {}
    return NextResponse.json({
      depositAddress: q?.depositAddress || q?.address,
      memo: q?.memo ?? null,
      deadline: q?.deadline,
      timeEstimate: q?.timeEstimate,
      quoteId: q?.id || q?.quoteId,
      minAmountInFormatted: q?.minAmountInFormatted,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[claims/deposit] FATAL ERROR:", e);
    console.error("[claims/deposit] Error message:", e?.message);
    console.error("[claims/deposit] Error body:", e?.body);
    console.error("[claims/deposit] Error response:", e?.response);
    return NextResponse.json({ error: e?.message || "Failed to prepare deposit" }, { status: 500 });
  }
}


