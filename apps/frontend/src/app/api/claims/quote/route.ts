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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { claimId, fromToken, destToken, fromTokenPriceUSD, destTokenPriceUSD, refundAddress } = body || {};
    if (!claimId || !fromToken?.tokenId || typeof fromToken?.decimals !== "number" || !destToken?.tokenId || typeof destToken?.decimals !== "number") {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: claim, error } = await supabase
      .from("claims")
      .select("id, amount, to_symbol, to_chain")
      .eq("id", claimId)
      .single();
    if (error || !claim) return NextResponse.json({ error: "Claim not found" }, { status: 404 });

    // Attempt EXACT_OUTPUT dry quote to find amountIn for payer token
    const toAsset = destToken.tokenId;

    // amount is stored in USD; convert USD -> destination token using provided price
    // Enforce a minimum effective payout of $3 to avoid very small swaps failing
    const rawAmountUsd = Number(claim.amount || 0);
    const amountUsd = Number.isFinite(rawAmountUsd) ? Math.max(rawAmountUsd, 3) : 3;
    const desiredOutHuman = (Number.isFinite(amountUsd) && Number(destTokenPriceUSD) > 0)
      ? String(amountUsd / Number(destTokenPriceUSD))
      : "0";
    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ""] = String(val).split(".");
      const cleanF = f.replace(/\D/g, "").slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, "") || "0") + (cleanF.padEnd(decimals, "0"));
      return BigInt(padded).toString();
    };
    const amountOutAtomic = toAtomic(desiredOutHuman, Number(destToken.decimals));

    try {
      // Use user-provided refund address if present, otherwise fallback to mocked refund address
      const refundTo = refundAddress || getRefundToForChain(fromToken.chain || "");
      if (!refundTo) {
        return NextResponse.json({
          error: "Could not determine refund address for quote",
          code: "REFUND_ADDRESS_REQUIRED",
        }, { status: 400 });
      }
      // For recipient in dry quote, use refund address as placeholder (doesn't matter for dry quote)
      const recipient = refundTo;
      
      const req: any = {
        dry: true,
        swapType: (QuoteRequest.swapType as any).EXACT_OUTPUT ?? "EXACT_OUTPUT",
        // Match working example: use SIMPLE deposit mode
        depositMode: 'SIMPLE',
        slippageTolerance: 100,
        originAsset: fromToken.tokenId,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset: toAsset,
        // For EXACT_OUTPUT, 1Click expects 'amount' to represent desired out in atomic units
        amount: amountOutAtomic,
        refundTo,
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient,
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        quoteWaitingTimeMs: 0,
        // Include app fees so quote matches real execution path
        appFees: [
          {
            recipient: 'lisabey.near',
            fee: 30,
          },
        ],
        virtualChainRecipient: null,
        virtualChainRefundRecipient: null,
        referral: null,
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
      // USD fallback
      const destUsd = Number(claim.amount);
      const amountInEst = Number(fromTokenPriceUSD) ? (destUsd / Number(fromTokenPriceUSD)) : null;
      return NextResponse.json({
        quote: null,
        amountInUSD: Number.isFinite(destUsd) ? destUsd : null,
        amountInEst: Number.isFinite(amountInEst || NaN) ? amountInEst : null
      }, { status: 200 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to get claim quote" }, { status: 500 });
  }
}


