'use server'

import { NextResponse } from "next/server";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
// Removed getRefundToForChain - now using user-provided refund addresses only

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
const REFERRAL_CODE = getEnv("REFERRAL_CODE", ["NEXT_PUBLIC_REFERRAL_CODE", "NEXT_PUBLIC_ONECLICK_REFERRAL"]);
OpenAPI.BASE = ONECLICK_BASE;
if (ONECLICK_JWT) OpenAPI.TOKEN = ONECLICK_JWT;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      fromToken, 
      toToken, 
      amountNeeded, // Amount in fromToken (human-readable)
      totalCostETH, // Total ETH needed on Base (human-readable)
      companionAddress, // Rhinestone companion wallet address
      userAddress,
      refundAddress, // User-provided refund address (required)
      orgReferral // Organization referral code (optional)
    } = body || {};
    
    if (!fromToken?.tokenId || !toToken?.tokenId || !amountNeeded || !totalCostETH || !companionAddress) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    if (!refundAddress) {
      return NextResponse.json({ error: "Refund address is required" }, { status: 400 });
    }

    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ""] = String(val).split(".");
      const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
      return BigInt(padded).toString();
    };

    const originAsset = fromToken.tokenId;
    const destinationAsset = toToken.tokenId;
    const originDecimals = Number(fromToken.decimals) || 18;
    const destDecimals = Number(toToken.decimals) || 18;
    
    // Convert human-readable amounts to atomic
    // Note: totalCostETH already includes gas fee buffer ($0.50 USD worth of ETH)
    const amountInAtomic = toAtomic(String(amountNeeded || "0"), originDecimals);
    const amountOutAtomic = toAtomic(String(totalCostETH || "0"), destDecimals);
    
    console.log("[lottery/deposit] Amounts:", {
      amountNeeded,
      totalCostETH,
      amountInAtomic,
      amountOutAtomic,
      note: "totalCostETH includes gas fee buffer for companion wallet",
    });

    // Log companion wallet address
    console.log("[lottery/deposit] === COMPANION WALLET ===");
    console.log("[lottery/deposit] Companion wallet address (Rhinestone):", companionAddress);
    console.log("[lottery/deposit] This address will receive ETH from NEAR Intents on Base");
    
    // Use user-provided refund address (required, no fallback)
    const refundTo = refundAddress;
    
    console.log("[lottery/deposit] Chain info:", {
      originChain: fromToken.chain,
      destChain: toToken.chain,
      refundTo: refundAddress,
      companionAddress, // This is where ETH will actually arrive
    });
    
    // Build quote request - match claims/quote route pattern
    // Use ORIGIN_CHAIN deposit/refund types like claims/quote does
    const req: QuoteRequest = {
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: 100,
      originAsset,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN, // Same as claims/quote
      destinationAsset,
      amount: amountInAtomic,
      refundTo: refundAddress, // User-provided refund address (required)
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN, // Same as claims/quote
      recipient: companionAddress, // Override with companion wallet address (where ETH arrives)
      recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN, // Specific address
      deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
    } as any;

    // Use orgReferral if provided, otherwise fallback to env REFERRAL_CODE
    const referralCode = orgReferral || REFERRAL_CODE;
    if (referralCode) (req as any).referral = referralCode;

    console.log("[lottery/deposit] Quote request:", JSON.stringify(req, null, 2));

    // Get quote (non-dry to get deposit address)
    let raw: any;
    try {
      raw = await OneClickService.getQuote(req);
      console.log("[lottery/deposit] Quote response:", JSON.stringify(raw, null, 2));
    } catch (quoteError: any) {
      console.error("[lottery/deposit] Quote ERROR:", quoteError?.message || quoteError);
      console.error("[lottery/deposit] Quote ERROR body:", quoteError?.body || quoteError?.response?.data);
      throw quoteError;
    }

    const q = (raw as any)?.quote || raw || {};

    // Extract deposit info
    const depositAddress = q?.depositAddress || q?.address;
    const minAmountInFormatted = q?.minAmountInFormatted || amountNeeded;

    console.log("[lottery/deposit] === DEPOSIT INFO ===");
    console.log("[lottery/deposit] Deposit address (where user sends funds):", depositAddress);
    console.log("[lottery/deposit] Companion wallet (where ETH arrives on Base):", companionAddress);
    console.log("[lottery/deposit] Amount to deposit:", minAmountInFormatted, fromToken.tokenId);
    console.log("[lottery/deposit] Will receive:", totalCostETH, "ETH on Base");
    console.log("[lottery/deposit] =========================================");

    if (!depositAddress) {
      throw new Error("No deposit address returned from quote");
    }

    return NextResponse.json({
      depositAddress,
      memo: q?.memo ?? null,
      deadline: q?.deadline,
      timeEstimate: q?.timeEstimate,
      quoteId: q?.id || q?.quoteId,
      minAmountInFormatted,
      amountNeeded, // Return the amount user needs to send
      companionAddress, // Also return companion address for reference
    }, { status: 200 });
  } catch (e: any) {
    console.error("[lottery/deposit] FATAL ERROR:", e);
    console.error("[lottery/deposit] Error message:", e?.message);
    console.error("[lottery/deposit] Error body:", e?.body || e?.response?.data);
    return NextResponse.json({ 
      error: e?.message || "Failed to prepare deposit",
      details: e?.body || e?.response?.data 
    }, { status: 500 });
  }
}

