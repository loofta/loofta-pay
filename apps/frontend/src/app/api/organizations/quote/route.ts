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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organizationId, fromToken, destToken, amount, refundAddress } = body || {};
    if (!organizationId || !fromToken?.tokenId || typeof fromToken?.decimals !== "number" || !amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data: organization, error } = await supabase
      .from("organizations")
      .select("id, token_symbol, token_chain")
      .eq("organization_id", organizationId)
      .single();
    if (error || !organization) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

    if (!organization.token_symbol || !organization.token_chain) {
      return NextResponse.json({ error: "Organization payment configuration incomplete" }, { status: 400 });
    }

    // Get destination asset ID
    const getDestinationAsset = (symbol: string, chain: string): string => {
      const fromTokenlist = getDefuseAssetIdFor(symbol, chain);
      if (fromTokenlist) return fromTokenlist;
      
      const sym = symbol?.toUpperCase();
      const ch = chain?.toLowerCase();
      
      if (sym === "ETH") {
        if (ch === "eth" || ch === "ethereum") return "nep141:eth.omft.near";
        if (ch === "arb" || ch === "arbitrum") return "nep141:arb.omft.near";
        if (ch === "base") return "nep141:base.omft.near";
        if (ch === "op" || ch === "optimism") return "nep141:op.omft.near";
        return `nep141:${ch}.omft.near`;
      }
      
      return `nep141:${ch}.omft.near`;
    };

    const toAsset = destToken?.tokenId || getDestinationAsset(organization.token_symbol, organization.token_chain);

    // Fetch token prices from OneClick service
    let destDecimals = destToken?.decimals || 6;
    let destPrice: number | undefined = destToken?.price;
    let fromTokenPrice: number | undefined = fromToken.price;
    
    try {
      const tokens: any = await (OneClickService as any).getTokens();
      const arr: any[] = Array.isArray(tokens) ? tokens : (tokens?.tokens || []);
      
      // Find destination token price
      if (!destPrice) {
        const foundDest = arr.find((t: any) => 
          String(t?.assetId || t?.tokenId || "").toLowerCase() === String(toAsset).toLowerCase()
        );
        if (foundDest) {
          if (typeof foundDest.decimals === "number") destDecimals = foundDest.decimals;
          if (typeof foundDest.price === "number") destPrice = foundDest.price;
        }
      }
      
      // Find from token price
      if (!fromTokenPrice) {
        const foundFrom = arr.find((t: any) => 
          String(t?.assetId || t?.tokenId || "").toLowerCase() === String(fromToken.tokenId).toLowerCase()
        );
        if (foundFrom && typeof foundFrom.price === "number") {
          fromTokenPrice = foundFrom.price;
        }
      }
    } catch (e) {
      console.error("[organizations/quote] Error fetching token prices:", e);
    }

    // amount is stored in USD; convert USD -> destination token using price
    const amountUsd = Number(amount || 0);
    const desiredOutHuman = (Number.isFinite(amountUsd) && typeof destPrice === "number" && destPrice > 0)
      ? String(amountUsd / destPrice)
      : "0";
    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ""] = String(val).split(".");
      const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
      return BigInt(padded).toString();
    };
    const amountOutAtomic = toAtomic(desiredOutHuman, destDecimals);

    try {
      // Use user-provided refund address if available, otherwise use default mocked address for quotes
      // For quotes (dry runs), we can use a default address since it's just for estimation
      const refundTo = refundAddress || getRefundToForChain(fromToken.chain || "");
      
      if (!refundTo) {
        return NextResponse.json({ 
          error: "Could not determine refund address for quote",
          code: "REFUND_ADDRESS_REQUIRED"
        }, { status: 400 });
      }
      // For recipient, use refundTo as placeholder (dry quote, recipient doesn't matter much)
      const recipient = refundTo;
      
      const req: any = {
        dry: true,
        swapType: (QuoteRequest.swapType as any).EXACT_OUTPUT ?? "EXACT_OUTPUT",
        slippageTolerance: 100,
        originAsset: fromToken.tokenId,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset: toAsset,
        amount: amountOutAtomic,
        refundTo,
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient,
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        quoteWaitingTimeMs: 0,
      };
      const raw = await OneClickService.getQuote(req as QuoteRequest);
      const q = (raw as any)?.quote || raw || {};
      let amountInFormatted = q?.amountInFormatted || null;
      if (!amountInFormatted && typeof q?.amountIn === "string" && typeof fromToken?.decimals === "number") {
        try {
          const human = Number(q.amountIn) / Math.pow(10, Number(fromToken.decimals));
          if (Number.isFinite(human)) amountInFormatted = String(human);
        } catch {}
      }
      return NextResponse.json({ quote: q, amountInFormatted }, { status: 200 });
    } catch {
      // USD fallback - use fetched prices
      const destUsd = Number(amount);
      const amountInEst = (typeof fromTokenPrice === "number" && fromTokenPrice > 0) 
        ? (destUsd / fromTokenPrice) 
        : null;
      return NextResponse.json({
        quote: null,
        amountInUSD: Number.isFinite(destUsd) ? destUsd : null,
        amountInEst: Number.isFinite(amountInEst || NaN) ? amountInEst : null
      }, { status: 200 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to get organization quote" }, { status: 500 });
  }
}
