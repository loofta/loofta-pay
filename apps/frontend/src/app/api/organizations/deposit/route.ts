'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
// Removed getRefundToForChain - now using user-provided refund addresses only
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
    const { organizationId, fromToken, amount, userAddress, orgReferral, refundAddress } = body || {};
    if (!organizationId || !fromToken?.tokenId || !fromToken?.decimals || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const trimmedOrgId = String(organizationId || "").trim();
    console.log("[organizations/deposit] Looking up organization with organizationId:", trimmedOrgId);
    
    // Try exact match first
    let { data: organization, error } = await supabase
      .from("organizations")
      .select("id, organization_id, recipient_wallet, token_symbol, token_chain, org_referral")
      .eq("organization_id", trimmedOrgId)
      .single();
    
    // If not found, try case-insensitive (for PostgreSQL)
    if (error && error.code === 'PGRST116') {
      console.log("[organizations/deposit] Trying case-insensitive lookup...");
      const { data: orgCaseInsensitive, error: errorCaseInsensitive } = await supabase
        .from("organizations")
        .select("id, organization_id, recipient_wallet, token_symbol, token_chain, org_referral")
        .ilike("organization_id", trimmedOrgId)
        .single();
      
      if (orgCaseInsensitive && !errorCaseInsensitive) {
        organization = orgCaseInsensitive;
        error = null;
        console.log("[organizations/deposit] Found organization with case-insensitive lookup");
      }
    }
    
    console.log("[organizations/deposit] Organization lookup result:", {
      found: !!organization,
      error: error?.message || null,
      errorCode: error?.code || null,
      organization_id: organization?.organization_id,
      hasRecipientWallet: !!organization?.recipient_wallet,
      token_symbol: organization?.token_symbol,
      token_chain: organization?.token_chain,
    });
    
    if (error) {
      console.error("[organizations/deposit] Supabase error:", error);
      // Check if it's a "not found" error or something else
      if (error.code === 'PGRST116') {
        return NextResponse.json({ 
          error: "Organization not found",
          details: `No organization found with organization_id: "${trimmedOrgId}"`
        }, { status: 404 });
      }
      return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
    }
    
    if (!organization) {
      return NextResponse.json({ 
        error: "Organization not found",
        details: `No organization found with organization_id: "${trimmedOrgId}"`
      }, { status: 404 });
    }

    if (!organization.recipient_wallet || !organization.token_symbol || !organization.token_chain) {
      return NextResponse.json({ error: "Organization payment configuration incomplete" }, { status: 400 });
    }

    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ""] = String(val).split(".");
      const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
      return BigInt(padded).toString();
    };
    const atomicIn = toAtomic(String(amount || "0"), Number(fromToken.decimals));

    // Get destination asset ID from tokenlist
    const getDestinationAsset = (symbol: string, chain: string): string => {
      const fromTokenlist = getDefuseAssetIdFor(symbol, chain);
      if (fromTokenlist) {
        console.log("[organizations/deposit] Found asset ID from tokenlist:", fromTokenlist);
        return fromTokenlist;
      }
      
      const sym = symbol?.toUpperCase();
      const ch = chain?.toLowerCase();
      
      if (sym === "ETH") {
        if (ch === "eth" || ch === "ethereum") return "nep141:eth.omft.near";
        if (ch === "arb" || ch === "arbitrum") return "nep141:arb.omft.near";
        if (ch === "base") return "nep141:base.omft.near";
        if (ch === "op" || ch === "optimism") return "nep141:op.omft.near";
        return `nep141:${ch}.omft.near`;
      }
      
      console.warn("[organizations/deposit] Could not find asset ID for", symbol, "on", chain);
      return `nep141:${ch}.omft.near`;
    };

    const destinationAsset = organization.token_symbol && organization.token_chain 
      ? getDestinationAsset(organization.token_symbol, organization.token_chain) 
      : "";
    
    // Check if origin chain requires INTENTS mode
    const originChain = String(fromToken?.chain || "").toLowerCase();
    const useIntentsMode = INTENTS_ONLY_CHAINS.has(originChain);
    
    // Determine same-chain and choose recipient type accordingly
    const destChain = String(organization.token_chain || "").toLowerCase();
    const sameChain = originChain === destChain;
    const sameToken = String(fromToken?.symbol || "").toUpperCase() === String(organization.token_symbol || "").toUpperCase();
    
    console.log("[organizations/deposit] Same-chain analysis:");
    console.log("[organizations/deposit]   Origin:", originChain, fromToken?.symbol);
    console.log("[organizations/deposit]   Dest:", destChain, organization.token_symbol);
    console.log("[organizations/deposit]   Same chain:", sameChain, "Same token:", sameToken);
    
    // Handle same-chain scenarios
    if (sameChain) {
      const NON_EVM_CHAINS = new Set(['sol', 'solana', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar', 'ton', 'tron', 'sui', 'ada', 'cardano', 'doge', 'dogecoin', 'ltc', 'litecoin', 'zec', 'zcash']);
      const isNonEvmChain = NON_EVM_CHAINS.has(originChain);
      
      if (sameToken) {
        // Same chain, same token → Direct transfer to recipient
        console.log("[organizations/deposit] Same chain + same token → Direct transfer to recipient");
        
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
          console.error("[organizations/deposit] Error fetching token price:", e);
        }
        
        // Calculate token amount from USD
        const amountUsd = Number(amount || 0);
        let tokenAmount = "0";
        if (Number.isFinite(amountUsd) && typeof tokenPrice === "number" && tokenPrice > 0) {
          const rawAmount = amountUsd / tokenPrice;
          tokenAmount = (Math.ceil(rawAmount * 1000000) / 1000000).toFixed(6);
        }
        
        console.log("[organizations/deposit] Direct transfer - USD:", amountUsd, "Token price:", tokenPrice, "Token amount:", tokenAmount);
        
        return NextResponse.json({
          directTransfer: true,
          depositAddress: organization.recipient_wallet,
          depositToken: fromToken.symbol,
          depositChain: originChain,
          amount: tokenAmount,
          minAmountInFormatted: tokenAmount,
          message: `Send ${organization.token_symbol} directly to the recipient address.`,
        }, { status: 200 });
      }
      
      // Same chain, different token
      if (isNonEvmChain) {
        console.log("[organizations/deposit] Non-EVM chain + different token → Error");
        return NextResponse.json({
          error: `For ${originChain.toUpperCase()} payments, you must pay with ${organization.token_symbol}. Cross-token swaps are only available on EVM chains.`,
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
      
      const fromSymbol = String(fromToken.symbol || "").toUpperCase();
      const toSymbol = String(organization.token_symbol || "").toUpperCase();
      
      if (!isRhinestoneSwapSupported(fromSymbol, toSymbol, chainId)) {
        return NextResponse.json({
          error: `Swap ${fromSymbol} → ${toSymbol} not supported on ${originChain}. Supported tokens: ETH, WETH, USDC, USDT.`,
          code: "TOKENS_NOT_SUPPORTED",
        }, { status: 400 });
      }
      
      // EVM chain, different token → Use companion wallet swap
      console.log("[organizations/deposit] EVM chain + different token → Companion swap");
      
      // Get token prices before calling companion swap
      let fromTokenPrice: number | undefined;
      let toTokenPrice: number | undefined;
      try {
        const tokens: any = await (OneClickService as any).getTokens();
        const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
        
        console.log("[organizations/deposit] Looking for token prices:", {
          fromSymbol,
          originChain,
          toSymbol,
          destChain,
          totalTokens: arr.length,
        });
        
        // Try to find by tokenId first (more reliable)
        const fromTokenId = fromToken.tokenId || fromToken.address;
        if (fromTokenId) {
          const foundById = arr.find((t: any) => 
            String(t?.tokenId || t?.assetId || "").toLowerCase() === String(fromTokenId).toLowerCase()
          );
          if (foundById && typeof foundById.price === "number" && foundById.price > 0) {
            fromTokenPrice = foundById.price;
            console.log("[organizations/deposit] Found fromToken price by ID:", fromTokenPrice);
          } else {
            console.warn("[organizations/deposit] fromToken price not found by ID:", {
              tokenId: fromTokenId,
              found: !!foundById,
              price: foundById?.price,
            });
          }
        }
        
        // Fallback to symbol + chain if not found by ID
        if (!fromTokenPrice) {
          const foundFrom = arr.find((t: any) => {
            const symbolMatch = String(t?.symbol || "").toUpperCase() === String(fromSymbol).toUpperCase();
            const chainMatch = String(t?.chain || t?.chainId || "").toLowerCase().includes(originChain);
            return symbolMatch && chainMatch;
          });
          if (foundFrom && typeof foundFrom.price === "number" && foundFrom.price > 0) {
            fromTokenPrice = foundFrom.price;
            console.log("[organizations/deposit] Found fromToken price by symbol+chain:", fromTokenPrice);
          } else {
            console.warn("[organizations/deposit] fromToken price not found by symbol+chain:", {
              symbol: fromSymbol,
              chain: originChain,
              found: !!foundFrom,
              price: foundFrom?.price,
            });
          }
        }
        
        // For toToken, we need to get its tokenId from the organization's token config
        // Since we don't have it directly, try symbol + chain
        const foundTo = arr.find((t: any) => {
          const symbolMatch = String(t?.symbol || "").toUpperCase() === String(toSymbol).toUpperCase();
          const chainMatch = String(t?.chain || t?.chainId || "").toLowerCase().includes(destChain);
          return symbolMatch && chainMatch;
        });
        if (foundTo && typeof foundTo.price === "number" && foundTo.price > 0) {
          toTokenPrice = foundTo.price;
          console.log("[organizations/deposit] Found toToken price:", toTokenPrice);
        } else {
          console.warn("[organizations/deposit] toToken price not found:", {
            symbol: toSymbol,
            chain: destChain,
            found: !!foundTo,
            price: foundTo?.price,
          });
        }
        
        if (!fromTokenPrice) {
          console.warn("[organizations/deposit] Could not find fromToken price for", fromSymbol, "on", originChain);
        }
        if (!toTokenPrice) {
          console.warn("[organizations/deposit] Could not find toToken price for", toSymbol, "on", destChain);
        }
      } catch (e) {
        console.error("[organizations/deposit] Error fetching token prices:", e);
      }
      
      try {
        const companionSwapResponse = await fetch(new URL("/api/organizations/companion-swap", request.url).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: organization.organization_id,
            fromToken: {
              symbol: fromSymbol,
              chain: originChain,
              decimals: fromToken.decimals,
              tokenId: fromToken.tokenId || fromToken.address, // Pass tokenId for better lookup
              price: fromTokenPrice, // Pass price if available
            },
            toToken: {
              symbol: toSymbol,
              chain: destChain,
              decimals: 6, // Will be updated by swap endpoint
              amount: amount, // USD amount, will be converted by endpoint
              price: toTokenPrice, // Pass price if available
            },
            recipientAddress: organization.recipient_wallet,
            amountUsd: Number(amount || 0),
          }),
        });
        
        const companionSwapData = await companionSwapResponse.json();
        
        if (companionSwapResponse.ok && companionSwapData.success) {
          console.log("[organizations/deposit] Companion swap created successfully");
          console.log("[organizations/deposit] Companion swap response:", {
            minAmountInFormatted: companionSwapData.minAmountInFormatted,
            estimatedTotal: companionSwapData.estimatedTotal,
          });
          return NextResponse.json({
            ...companionSwapData,
            isCompanionSwap: true,
            minAmountInFormatted: companionSwapData.minAmountInFormatted, // This should be in token units, not USD
          }, { status: 200 });
        } else {
          console.error("[organizations/deposit] Companion swap failed:", companionSwapData.error);
          return NextResponse.json({
            error: companionSwapData.error || "Failed to create swap route",
            code: companionSwapData.code || "SWAP_FAILED",
          }, { status: 400 });
        }
      } catch (swapError: any) {
        console.error("[organizations/deposit] Companion swap error:", swapError?.message);
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
    
    // amount is stored in USD, convert to destination token using price
    const amountUsd = Number(amount || 0);
    const destHumanOut = (Number.isFinite(amountUsd) && typeof destPrice === "number" && destPrice > 0)
      ? (amountUsd / destPrice)
      : 0;
    const destHumanOutRoundedUp = (() => {
      const factor = Math.pow(10, 6);
      return Math.ceil(destHumanOut * factor) / factor;
    })();
    const amountOutAtomic = toAtomic(String(destHumanOutRoundedUp || "0"), destDecimals);
    
    // Use provided refund address (required for swaps, optional for direct transfers)
    if (!refundAddress) {
      return NextResponse.json({ error: "Refund address is required" }, { status: 400 });
    }
    const finalRefundAddress = refundAddress;
    
    let originDecimals = Number(fromToken.decimals) || 8;
    let originPrice: number | undefined = undefined;
    try {
      const tokens: any = await (OneClickService as any).getTokens();
      const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
      const foundOrigin = arr.find((t: any) => String(t?.assetId || t?.tokenId || "").toLowerCase() === String(fromToken.tokenId).toLowerCase());
      if (foundOrigin && typeof foundOrigin.decimals === "number") originDecimals = foundOrigin.decimals;
      if (foundOrigin && typeof foundOrigin.price === "number") originPrice = foundOrigin.price;
    } catch {}
    
    const amountInHuman = (Number.isFinite(amountUsd) && typeof originPrice === "number" && originPrice > 0)
      ? (amountUsd / originPrice)
      : 0;
    const amountInWithBuffer = amountInHuman * 1.02;
    const amountInAtomic = toAtomic(String(amountInWithBuffer || "0"), originDecimals);
    
    const NON_EVM_DEST_CHAINS = new Set(['sol', 'solana', 'btc', 'bitcoin', 'xrp', 'xlm', 'stellar', 'ton', 'tron', 'sui', 'ada', 'cardano', 'doge', 'dogecoin', 'ltc', 'litecoin', 'zec', 'zcash']);
    const isNonEvmDestination = NON_EVM_DEST_CHAINS.has(destChain);
    
    console.log("[organizations/deposit] Route analysis:");
    console.log("[organizations/deposit]   Origin chain:", originChain, "isIntentsMode:", useIntentsMode);
    console.log("[organizations/deposit]   Dest chain:", destChain, "isNonEvmDest:", isNonEvmDestination);
    console.log("[organizations/deposit]   Same chain:", sameChain);
    
    const recipientAddress = organization.recipient_wallet;
    
    const req: QuoteRequest = useIntentsMode ? {
      dry: false,
      swapType: "EXACT_INPUT" as any,
      slippageTolerance: 100,
      originAsset: fromToken.tokenId,
      depositType: "INTENTS" as any,
      destinationAsset,
      amount: amountInAtomic,
      refundTo: userAddress || finalRefundAddress,
      refundType: "INTENTS" as any,
      recipient: recipientAddress,
      recipientType: "INTENTS" as any,
      deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
      ...(userAddress ? { authMethod: "evm", userAddress } : {}),
    } as any : {
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: 100,
      originAsset: fromToken.tokenId,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      destinationAsset,
      amount: amountInAtomic,
      refundTo: finalRefundAddress,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: recipientAddress,
      recipientType: sameChain 
        ? (QuoteRequest.recipientType as any).ORIGIN_CHAIN 
        : QuoteRequest.recipientType.DESTINATION_CHAIN,
      deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 5000,
      referral: orgReferral || organization.org_referral || "loofta",
    } as any;

    console.log("[organizations/deposit] === FULL REQUEST ===");
    console.log("[organizations/deposit] Input:", { organizationId, fromToken, amount, userAddress });
    console.log("[organizations/deposit] Organization:", organization);
    console.log("[organizations/deposit] useIntentsMode:", useIntentsMode);
    console.log("[organizations/deposit] destinationAsset:", destinationAsset, `(from ${organization.token_symbol} on ${organization.token_chain})`);
    console.log("[organizations/deposit] Full quoteRequest:", JSON.stringify(req, null, 2));
    
    let raw: any;
    try {
      const dryReq = { ...req, dry: true };
      console.log("[organizations/deposit] Trying dry run first to validate route...");
      try {
        const dryResult = await OneClickService.getQuote(dryReq as any);
        console.log("[organizations/deposit] Dry run succeeded:", JSON.stringify(dryResult, null, 2));
      } catch (dryError: any) {
        console.warn("[organizations/deposit] Dry run failed:", dryError?.message || dryError);
      }
      
      raw = await OneClickService.getQuote(req);
      console.log("[organizations/deposit] Quote response:", JSON.stringify(raw, null, 2));
    } catch (quoteError: any) {
      const errorMsg = quoteError?.message || String(quoteError);
      const errorBody = quoteError?.body || quoteError?.response;
      console.error("[organizations/deposit] Quote ERROR:", errorMsg);
      console.error("[organizations/deposit] Quote ERROR body:", errorBody);
      
      if (errorMsg?.includes("Invalid input") || errorBody?.message?.includes("Invalid input") || errorMsg?.includes("Failed to get quote")) {
        return NextResponse.json({ 
          error: "Route not available. Please try another token.",
          code: "ROUTE_NOT_AVAILABLE"
        }, { status: 400 });
      } else {
        throw quoteError;
      }
    }
    const q = (raw as any)?.quote || raw || {};

    // Round UP the minAmountIn to avoid INCOMPLETE_DEPOSIT issues
    const minAmountInRaw = q?.minAmountIn || q?.amountIn;
    let minAmountInFormatted = q?.minAmountInFormatted || q?.amountInFormatted;
    
    if (minAmountInRaw) {
      const decimals = Number(fromToken.decimals) || 18;
      const amountFloat = Number(minAmountInRaw) / Math.pow(10, decimals);
      minAmountInFormatted = (Math.ceil(amountFloat * 1000000) / 1000000).toFixed(6);
      
      console.log("[organizations/deposit] Amount rounded up:");
      console.log("[organizations/deposit]   Original:", q?.minAmountInFormatted);
      console.log("[organizations/deposit]   Rounded up:", minAmountInFormatted);
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
    console.error("[organizations/deposit] FATAL ERROR:", e);
    console.error("[organizations/deposit] Error message:", e?.message);
    console.error("[organizations/deposit] Error body:", e?.body);
    return NextResponse.json({ error: e?.message || "Failed to prepare deposit" }, { status: 500 });
  }
}
