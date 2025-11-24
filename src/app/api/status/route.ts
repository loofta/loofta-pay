'use server'

import { NextResponse } from "next/server";
import { OneClickService, OpenAPI } from "@defuse-protocol/one-click-sdk-typescript";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const depositAddress = searchParams.get("depositAddress");
    if (!depositAddress) {
      return NextResponse.json({ error: "Missing depositAddress" }, { status: 400 });
    }
    const status = await OneClickService.getExecutionStatus(depositAddress);

    // Persist status if we have a matching claim_intents row
    try {
      const supabase = getSupabaseAdmin();
      // Update claim_intents
      const upd = await supabase
        .from("claim_intents")
        .update({
          status: (status as any)?.status || (status as any)?.executionStatus || null,
          last_status_payload: status || null,
        })
        .eq("deposit_address", depositAddress)
        .select("claim_id, status")
        .single();
      const s = String((status as any)?.status || (status as any)?.executionStatus || "").toUpperCase();
      const terminal = ["SUCCESS", "REFUNDED", "EXPIRED", "FAILED"];
      if (upd?.data?.claim_id && s) {
        await supabase.from("claims").update({ status: terminal.includes(s) ? s : "IN_FLIGHT" }).eq("id", upd.data.claim_id);
      }
    } catch {}

    return NextResponse.json(status, { status: 200 });
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    return NextResponse.json({ error: e?.message || "Failed to fetch status" }, { status });
  }
}


