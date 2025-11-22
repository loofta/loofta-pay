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
    if (!res.ok) {
      return NextResponse.json({ error: data?.error || "Submit failed" }, { status: res.status });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to submit tx" }, { status: 500 });
  }
}


