'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { getRefundToForChain } from "@/lib/refundAddresses";
import { getDefuseAssetIdFor } from "@/lib/tokenlist";

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

    // Get destination asset ID from tokenlist (proper format for 1Click/NEAR Intents)
    // This looks up the defuseAssetId from the production tokenlist
    const getDestinationAsset = (symbol: string, chain: string): string => {
      // First, try to get from tokenlist (most reliable)
      const fromTokenlist = getDefuseAssetIdFor(symbol, chain);
      if (fromTokenlist) {
        console.log("[claims/deposit] Found asset ID from tokenlist:", fromTokenlist);
        return fromTokenlist;
      }
      
      // Fallback for ETH on EVM chains (OMFT format)
      const sym = symbol?.toUpperCase();
      const ch = chain?.toLowerCase();
      
      if (sym === "ETH") {
        if (ch === "eth" || ch === "ethereum") return "nep141:eth.omft.near";
        if (ch === "arb" || ch === "arbitrum") return "nep141:arb.omft.near";
        if (ch === "base") return "nep141:base.omft.near";
        if (ch === "op" || ch === "optimism") return "nep141:op.omft.near";
        return `nep141:${ch}.omft.near`;
      }
      
      // Last fallback - this will likely fail but at least we tried
      console.warn("[claims/deposit] Could not find asset ID for", symbol, "on", chain);
      return `nep141:${ch}.omft.near`;
    };

    const destinationAsset = claim.to_symbol && claim.to_chain 
      ? getDestinationAsset(claim.to_symbol, claim.to_chain) 
      : "";
    
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
    
    // Determine if destination is a non-EVM chain (requires special handling)
    const destChain = String(claim.to_chain || "").toLowerCase();
    const NON_EVM_DEST_CHAINS = new Set(['sol', 'solana', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar', 'ton', 'tron', 'sui', 'ada', 'cardano', 'doge', 'dogecoin', 'ltc', 'litecoin', 'zec', 'zcash']);
    const isNonEvmDestination = NON_EVM_DEST_CHAINS.has(destChain);
    
    console.log("[claims/deposit] Route analysis:");
    console.log("[claims/deposit]   Origin chain:", originChain, "isIntentsMode:", useIntentsMode);
    console.log("[claims/deposit]   Dest chain:", destChain, "isNonEvmDest:", isNonEvmDestination);
    console.log("[claims/deposit]   Same chain:", sameChain);
    
    // Validate recipient address format based on destination chain
    const recipientAddress = claim.recipient_address;
    if (isNonEvmDestination) {
      if (destChain === 'sol' || destChain === 'solana') {
        // Solana addresses are Base58, typically 44 characters
        const isSolanaFormat = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipientAddress);
        console.log("[claims/deposit] Solana recipient validation:", { recipientAddress, isSolanaFormat, length: recipientAddress?.length });
        if (!isSolanaFormat) {
          console.error("[claims/deposit] Invalid Solana address format!");
        }
        
        // ROUTE LIMITATION: Not all chains have liquidity for SOL destinations
        const SUPPORTED_ORIGIN_CHAINS_FOR_SOL = new Set(['eth', 'ethereum', 'sol', 'solana']);
        if (!SUPPORTED_ORIGIN_CHAINS_FOR_SOL.has(originChain)) {
          console.error(`[claims/deposit] Route not supported: ${originChain} → sol`);
          return NextResponse.json({ 
            error: "Route not available. Please try another token.",
            code: "ROUTE_NOT_AVAILABLE"
          }, { status: 400 });
        }
      }
    } else {
      // EVM addresses are 0x-prefixed, 42 characters
      const isEvmFormat = /^0x[a-fA-F0-9]{40}$/.test(recipientAddress);
      console.log("[claims/deposit] EVM recipient validation:", { recipientAddress, isEvmFormat });
    }
    
    // Build request based on deposit mode
    // Note: Using EXACT_INPUT is more universally supported than EXACT_OUTPUT
    // We'll calculate the input amount based on prices and add a buffer
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
      // Regular mode - use EXACT_INPUT (more universally supported)
      // amountInAtomic is calculated with a buffer to ensure enough output
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: 100,
      originAsset: fromToken.tokenId,
      // depositType: always ORIGIN_CHAIN when depositing from external chain
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      destinationAsset,
      // Use input amount (with buffer) instead of output amount
      amount: amountInAtomic,
      // refundTo: treasury address on origin chain
      refundTo: refundAddress,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      // recipient: the actual destination address
      recipient: claim.recipient_address,
      // recipientType: DESTINATION_CHAIN for withdrawing to external chain
      // Note: This works for both EVM and non-EVM destinations per NEAR Intents docs
      recipientType: sameChain 
        ? (QuoteRequest.recipientType as any).ORIGIN_CHAIN 
        : QuoteRequest.recipientType.DESTINATION_CHAIN,
      deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 5000, // Increased to 5s for better quote response
      referral: "loofta", // Add referral for tracking
    } as any;

    // Debug log (visible in server logs)
    console.log("[claims/deposit] === FULL REQUEST ===");
    console.log("[claims/deposit] Input:", { claimId, fromToken, amount, userAddress });
    console.log("[claims/deposit] Claim:", claim);
    console.log("[claims/deposit] useIntentsMode:", useIntentsMode);
    console.log("[claims/deposit] destinationAsset:", destinationAsset, `(from ${claim.to_symbol} on ${claim.to_chain})`);
    console.log("[claims/deposit] destDecimals:", destDecimals);
    console.log("[claims/deposit] destPrice:", destPrice);
    console.log("[claims/deposit] amountOutAtomic:", amountOutAtomic);
    console.log("[claims/deposit] originDecimals:", originDecimals);
    console.log("[claims/deposit] originPrice:", originPrice);
    console.log("[claims/deposit] amountInHuman:", amountInHuman);
    console.log("[claims/deposit] amountInWithBuffer:", amountInWithBuffer);
    console.log("[claims/deposit] amountInAtomic:", amountInAtomic);
    console.log("[claims/deposit] Full quoteRequest:", JSON.stringify(req, null, 2));
    
    let raw: any;
    try {
      // First try a dry run to validate the route (uses simpler validation)
      const dryReq = { ...req, dry: true };
      console.log("[claims/deposit] Trying dry run first to validate route...");
      try {
        const dryResult = await OneClickService.getQuote(dryReq as any);
        console.log("[claims/deposit] Dry run succeeded:", JSON.stringify(dryResult, null, 2));
      } catch (dryError: any) {
        console.warn("[claims/deposit] Dry run failed:", dryError?.message || dryError);
        // Continue anyway - some routes may only work with non-dry
      }
      
      raw = await OneClickService.getQuote(req);
      console.log("[claims/deposit] Quote response:", JSON.stringify(raw, null, 2));
    } catch (quoteError: any) {
      const errorMsg = quoteError?.message || String(quoteError);
      const errorBody = quoteError?.body || quoteError?.response;
      console.error("[claims/deposit] Quote ERROR:", errorMsg);
      console.error("[claims/deposit] Quote ERROR body:", errorBody);
      
      // If the error mentions amount being too low, add helpful message
      if (errorMsg?.includes("too low") || errorBody?.message?.includes("too low")) {
        console.error("[claims/deposit] Amount might be below minimum for this route");
      }
      
      // If error is "Invalid input data", log more diagnostic info
      if (errorMsg?.includes("Invalid input") || errorBody?.message?.includes("Invalid input")) {
        console.error("[claims/deposit] Potential issues:");
        console.error("[claims/deposit]   - Check if route is supported:", fromToken.tokenId, "->", destinationAsset);
        console.error("[claims/deposit]   - Check recipient address format:", claim.recipient_address);
        console.error("[claims/deposit]   - Check amount is above minimum:", amountInAtomic);
        console.error("[claims/deposit]   - depositType:", req.depositType, "recipientType:", req.recipientType);
        
        // Try with EXACT_OUTPUT as fallback
        console.log("[claims/deposit] Trying EXACT_OUTPUT as fallback...");
        try {
          const fallbackReq = {
            ...req,
            swapType: QuoteRequest.swapType.EXACT_OUTPUT,
            amount: amountOutAtomic,
          };
          console.log("[claims/deposit] Fallback request:", JSON.stringify(fallbackReq, null, 2));
          raw = await OneClickService.getQuote(fallbackReq);
          console.log("[claims/deposit] Fallback succeeded:", JSON.stringify(raw, null, 2));
        } catch (fallbackError: any) {
          console.error("[claims/deposit] Fallback also failed:", fallbackError?.message);
          throw quoteError; // Throw original error
        }
      } else {
        throw quoteError;
      }
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


