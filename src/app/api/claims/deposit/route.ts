'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";

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
    const { claimId, fromToken, amount } = body || {};
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

    const req: QuoteRequest = {
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: 100,
      originAsset: fromToken.tokenId,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      destinationAsset: claim.to_symbol && claim.to_chain ? (claim.to_symbol && claim.to_chain ? `nep141:${claim.to_chain}.omft.near` : "") : "",
      amount: atomicIn,
      refundTo: fromToken.chain === "near" ? "system.near" : "0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11",
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: claim.recipient_address,
      recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
      deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      quoteWaitingTimeMs: 3000,
    } as any;

    const raw = await OneClickService.getQuote(req);
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
    return NextResponse.json({ error: e?.message || "Failed to prepare deposit" }, { status: 500 });
  }
}


