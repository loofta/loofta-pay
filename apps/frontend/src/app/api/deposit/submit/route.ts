'use server'

import { NextResponse } from "next/server";
import { OpenAPI } from "@defuse-protocol/one-click-sdk-typescript";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { txHash, depositAddress, nearSenderAccount, memo } = body || {};
    if (!txHash || !depositAddress) {
      return NextResponse.json({ error: "Missing txHash or depositAddress" }, { status: 400 });
    }
    const res = await fetch(`${ONECLICK_BASE}/v0/deposit/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ONECLICK_JWT ? { Authorization: `Bearer ${ONECLICK_JWT}` } : {}),
      },
      body: JSON.stringify({ txHash, depositAddress, nearSenderAccount, memo }),
    });

    const data = await res.json().catch(() => ({}));
    try {
      const qr = (data as any)?.quoteResponse || {};
      const q = qr?.quote || {};
      const req = qr?.quoteRequest || {};
      console.log("[deposit/submit] status", res.status, "ok", res.ok);
      console.log("[deposit/submit] quoteRequest", {
        swapType: req?.swapType,
        depositType: req?.depositType,
        recipientType: req?.recipientType,
        originAsset: req?.originAsset,
        destinationAsset: req?.destinationAsset,
        amount: req?.amount,
        refundType: req?.refundType,
        deadline: req?.deadline,
      });
      console.log("[deposit/submit] quote", {
        amountIn: q?.amountIn,
        amountInFormatted: q?.amountInFormatted,
        minAmountIn: q?.minAmountIn,
        amountOut: q?.amountOut,
        amountOutFormatted: q?.amountOutFormatted,
        minAmountOut: q?.minAmountOut,
        depositAddress: q?.depositAddress || q?.address,
        deadline: q?.deadline,
        timeEstimate: q?.timeEstimate,
      });
      if ((data as any)?.error) {
        console.warn("[deposit/submit] error", (data as any)?.error);
      }
    } catch {}
    if (!res.ok) {
      return NextResponse.json({ error: data?.error || "Submit failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to submit tx" }, { status: 500 });
  }
}


