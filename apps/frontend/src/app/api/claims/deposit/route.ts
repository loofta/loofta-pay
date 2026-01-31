'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { getRefundToForChain } from "@/lib/refundAddresses";
import { getDefuseAssetIdFor } from "@/lib/tokenlist";
import { 
  isRhinestoneChainSupported, 
  isRhinestoneSwapSupported,
  getRhinestoneChainId,
} from "@/config/rhinestoneChains";

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
    const { claimId, claim: claimData, fromToken, amount, userAddress, refundAddress, orgReferral, isPrivate } = body || {};
    if (!claimId || !fromToken?.tokenId || !fromToken?.decimals || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    
    // Use claim data passed from the page (already fetched from backend)
    // No need to query Supabase again - we have the data!
    if (!claimData) {
      return NextResponse.json({ error: "Claim data is required" }, { status: 400 });
    }
    
    const claim = claimData;
    console.log('[claims/deposit] Using claim data from request:', claim.id);

    // Enforce private payment if claim requires it
    if (claim.is_private === true) {
      return NextResponse.json({ 
        error: "This payment link requires private payments only. Please use the private payment option.",
        code: "PRIVATE_PAYMENT_REQUIRED"
      }, { status: 400 });
    }

    // For private cross-chain payments, forward to backend to create Privy wallet
    const originChain = String(fromToken.chain || '').toLowerCase();
    const destChain = String(claim.to_chain || '').toLowerCase();
    const isCrossChain = originChain !== destChain;
    const isPrivateCrossChain = isPrivate && isCrossChain && destChain === 'solana' && claim.to_symbol === 'USDC';
    
    if (isPrivateCrossChain) {
      // Forward to backend API to create Privy wallet
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      try {
        const backendResponse = await fetch(`${backendUrl}/claims/deposit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId,
            fromToken,
            amount,
            userAddress,
            refundAddress,
            orgReferral,
            isPrivate: true,
          }),
        });
        
        if (backendResponse.ok) {
          const backendData = await backendResponse.json();
          return NextResponse.json(backendData);
        } else {
          const errorData = await backendResponse.json().catch(() => ({}));
          return NextResponse.json({ 
            error: errorData.error || "Failed to create deposit address",
            code: errorData.code 
          }, { status: backendResponse.status });
        }
      } catch (error: any) {
        console.error("[claims/deposit] Backend API error:", error);
        return NextResponse.json({ 
          error: "Failed to connect to backend",
          code: "BACKEND_ERROR"
        }, { status: 500 });
      }
    }

    // Standard payment flow - continue with existing logic
    // For real deposits, a user-provided refund address is required
    if (!refundAddress) {
      return NextResponse.json({ error: "Refund address is required", code: "REFUND_ADDRESS_REQUIRED" }, { status: 400 });
    }
    const finalRefundAddress = refundAddress;

    // Still need Supabase for storing claim_intents (result of 1Click API call)
    const supabase = getSupabaseAdmin();

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
    // Note: originChain and destChain are already declared above (lines 57-58)
    const useIntentsMode = INTENTS_ONLY_CHAINS.has(originChain);
    
    // Determine same-chain and choose recipient type accordingly
    // Note: destChain is already declared above (line 58)
    const sameChain = originChain === destChain;
    const sameToken = String(fromToken?.symbol || "").toUpperCase() === String(claim.to_symbol || "").toUpperCase();
    
    console.log("[claims/deposit] Same-chain analysis:");
    console.log("[claims/deposit]   Origin:", originChain, fromToken?.symbol);
    console.log("[claims/deposit]   Dest:", destChain, claim.to_symbol);
    console.log("[claims/deposit]   Same chain:", sameChain, "Same token:", sameToken);
    
    // Handle same-chain scenarios
    if (sameChain) {
      // Check if it's non-EVM
      const NON_EVM_CHAINS = new Set(['sol', 'solana', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar', 'ton', 'tron', 'sui', 'ada', 'cardano', 'doge', 'dogecoin', 'ltc', 'litecoin', 'zec', 'zcash']);
      const isNonEvmChain = NON_EVM_CHAINS.has(originChain);
      
      if (sameToken) {
        // Same chain, same token → Direct transfer to recipient (no need for swap)
        console.log("[claims/deposit] Same chain + same token → Direct transfer to recipient");
        
        // Get token price to convert USD → token amount
        let tokenPrice: number | undefined = undefined;
        let tokenDecimals = Number(fromToken.decimals) || 18;
        try {
          const tokens: any = await (OneClickService as any).getTokens();
          const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
          const foundToken = arr.find((t: any) => 
            String(t?.symbol || "").toUpperCase() === String(fromToken.symbol || "").toUpperCase() &&
            String(t?.chain || t?.chainId || "").toLowerCase().includes(originChain)
          );
          if (foundToken && typeof foundToken.price === "number") tokenPrice = foundToken.price;
          if (foundToken && typeof foundToken.decimals === "number") tokenDecimals = foundToken.decimals;
        } catch (e) {
          console.error("[claims/deposit] Error fetching token price:", e);
        }
        
        // Calculate token amount from USD
        const amountUsd = Number(claim.amount || 0);
        let tokenAmount = "0";
        if (Number.isFinite(amountUsd) && typeof tokenPrice === "number" && tokenPrice > 0) {
          const rawAmount = amountUsd / tokenPrice;
          // Round up to 6 decimals
          tokenAmount = (Math.ceil(rawAmount * 1000000) / 1000000).toFixed(6);
        }
        
        console.log("[claims/deposit] Direct transfer - USD:", amountUsd, "Token price:", tokenPrice, "Token amount:", tokenAmount);
        
        return NextResponse.json({
          directTransfer: true,
          depositAddress: claim.recipient_address,
          depositToken: fromToken.symbol,
          depositChain: originChain,
          amount: tokenAmount,
          minAmountInFormatted: tokenAmount,
          message: `Send ${claim.to_symbol} directly to the recipient address.`,
        }, { status: 200 });
      }
      
      // Same chain, different token
      if (isNonEvmChain) {
        // Non-EVM chains: Must use same token (no swap capability)
        console.log("[claims/deposit] Non-EVM chain + different token → Error");
        return NextResponse.json({
          error: `For ${originChain.toUpperCase()} payments, you must pay with ${claim.to_symbol}. Cross-token swaps are only available on EVM chains.`,
          code: "NON_EVM_SAME_TOKEN_REQUIRED",
        }, { status: 400 });
      }
      
      // EVM chain, different token → Use companion wallet swap
      const chainId = getRhinestoneChainId(originChain);
      if (!chainId) {
        return NextResponse.json({
          error: `Chain ${originChain} is not supported for swaps. Supported: Ethereum, Base, Optimism, Arbitrum, Polygon, zkSync.`,
          code: "CHAIN_NOT_SUPPORTED",
        }, { status: 400 });
      }
      
      // Check if tokens are supported for swap
      const fromSymbol = String(fromToken.symbol || "").toUpperCase();
      const toSymbol = String(claim.to_symbol || "").toUpperCase();
      
      if (!isRhinestoneSwapSupported(fromSymbol, toSymbol, chainId)) {
        return NextResponse.json({
          error: `Swap ${fromSymbol} → ${toSymbol} not supported on ${originChain}. Supported tokens: ETH, WETH, USDC, USDT.`,
          code: "TOKENS_NOT_SUPPORTED",
        }, { status: 400 });
      }
      
      // Create companion swap
      console.log("[claims/deposit] EVM chain + different token → Companion swap");
      try {
        const companionSwapResponse = await fetch(new URL("/api/claims/companion-swap", request.url).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            claimId,
            fromToken: {
              symbol: fromSymbol,
              chain: originChain,
              decimals: fromToken.decimals,
            },
            toToken: {
              symbol: toSymbol,
              chain: destChain,
              decimals: 6, // Will be updated by swap endpoint
              amount: String(claim.amount),
            },
            recipientAddress: claim.recipient_address,
            amountUsd: Number(claim.amount || 0),
          }),
        });
        
        const companionSwapData = await companionSwapResponse.json();
        
        if (companionSwapResponse.ok && companionSwapData.success) {
          console.log("[claims/deposit] Companion swap created successfully");
          return NextResponse.json(companionSwapData, { status: 200 });
        } else {
          console.error("[claims/deposit] Companion swap failed:", companionSwapData.error);
          return NextResponse.json({
            error: companionSwapData.error || "Failed to create swap route",
            code: companionSwapData.code || "SWAP_FAILED",
          }, { status: 400 });
        }
      } catch (swapError: any) {
        console.error("[claims/deposit] Companion swap error:", swapError?.message);
        return NextResponse.json({
          error: "Failed to create swap route. Please try another token.",
          code: "SWAP_ERROR",
        }, { status: 500 });
      }
    }
    
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
    
    // Use the same finalRefundAddress defined above (required from user)
    
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
    // destChain is already defined above
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
        
        // Check if direct route might not work (non-ETH mainnet to Solana)
        const DIRECT_ROUTE_CHAINS_FOR_SOL = new Set(['eth', 'ethereum', 'sol', 'solana']);
        if (!DIRECT_ROUTE_CHAINS_FOR_SOL.has(originChain)) {
          console.log(`[claims/deposit] Direct route ${originChain} → sol may not work, will try 2-hop if needed`);
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
      refundTo: userAddress || finalRefundAddress,
      refundType: "INTENTS" as any,
      recipient: claim.recipient_address,
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
      refundTo: finalRefundAddress,
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
      referral: orgReferral || "loofta", // Use orgReferral if provided, otherwise default to "loofta"
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
      
      // If error is "Invalid input data", try 2-hop via companion wallet
      if (errorMsg?.includes("Invalid input") || errorBody?.message?.includes("Invalid input") || errorMsg?.includes("Failed to get quote")) {
        console.error("[claims/deposit] Direct route failed, trying 2-hop via ETH mainnet...");
        console.error("[claims/deposit]   - Route attempted:", fromToken.tokenId, "->", destinationAsset);
        
        // Try 2-hop via companion wallet (source → ETH mainnet → destination)
        try {
          const companionResponse = await fetch(new URL("/api/claims/companion", request.url).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              claimId,
              fromToken,
              destinationAsset,
              destinationAmount: amountOutAtomic,
              recipientAddress: claim.recipient_address,
              amountUsd: Number(claim.amount || 0),
            }),
          });
          
          const companionData = await companionResponse.json();
          
          if (companionResponse.ok && companionData.success) {
            console.log("[claims/deposit] 2-hop route created successfully");
            return NextResponse.json({
              ...companionData,
              twoHop: true,
            }, { status: 200 });
          } else {
            console.error("[claims/deposit] 2-hop also failed:", companionData.error);
            return NextResponse.json({ 
              error: companionData.error || "Route not available. Please try another token.",
              code: companionData.code || "ROUTE_NOT_AVAILABLE"
            }, { status: 400 });
          }
        } catch (companionError: any) {
          console.error("[claims/deposit] 2-hop companion error:", companionError?.message);
          return NextResponse.json({ 
            error: "Route not available. Please try another token.",
            code: "ROUTE_NOT_AVAILABLE"
          }, { status: 400 });
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
          // Store route information for timing analysis
          from_chain: String(fromToken?.chain || "").toLowerCase() || null,
          to_chain: String(claim.to_chain || "").toLowerCase() || null,
        })
        .select("id")
        .single();
      // Also set parent claim status to PENDING_DEPOSIT
      await supabase.from("claims").update({ status: "PENDING_DEPOSIT" }).eq("id", claimId);
    } catch {}
    
    // Round UP the minAmountIn to avoid INCOMPLETE_DEPOSIT issues
    const minAmountInRaw = q?.minAmountIn || q?.amountIn;
    let minAmountInFormatted = q?.minAmountInFormatted || q?.amountInFormatted;
    
    if (minAmountInRaw) {
      // Round UP to 6 decimal places to avoid rounding issues
      const decimals = Number(fromToken.decimals) || 18;
      const amountFloat = Number(minAmountInRaw) / Math.pow(10, decimals);
      minAmountInFormatted = (Math.ceil(amountFloat * 1000000) / 1000000).toFixed(6);
      
      console.log("[claims/deposit] Amount rounded up:");
      console.log("[claims/deposit]   Original:", q?.minAmountInFormatted);
      console.log("[claims/deposit]   Rounded up:", minAmountInFormatted);
    }
    
    return NextResponse.json({
      depositAddress: q?.depositAddress || q?.address,
      memo: q?.memo ?? null,
      deadline: q?.deadline,
      timeEstimate: q?.timeEstimate,
      quoteId: q?.id || q?.quoteId,
      minAmountIn: minAmountInRaw,
      minAmountInFormatted,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[claims/deposit] FATAL ERROR:", e);
    console.error("[claims/deposit] Error message:", e?.message);
    console.error("[claims/deposit] Error body:", e?.body);
    console.error("[claims/deposit] Error response:", e?.response);
    return NextResponse.json({ error: e?.message || "Failed to prepare deposit" }, { status: 500 });
  }
}


