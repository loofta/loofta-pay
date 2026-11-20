import { NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

// 2026-11-20: an attacker wrote user_deposits rows straight to status "complete" with amounts like 999999
// and -500, which fed the admin analytics (total volume showed $1M). A client may only open a deposit as
// pending, and may only mark it failed/cancelled. "complete" is set by the server-side reconcilers and
// webhooks. The one exception is Blink, whose completion only exists in the browser; it is accepted with a
// sane amount and a per-user daily limit, so it can be abused only in small amounts.
const CLIENT_OPEN_STATUSES = new Set(["pending"]);
const CLIENT_CLOSE_STATUSES = new Set(["failed", "cancelled"]);
const MAX_CLIENT_DEPOSIT_USDC = 2000;
const MAX_BLINK_COMPLETE_PER_DAY = 5;

function validAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_CLIENT_DEPOSIT_USDC;
}

export async function GET(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_deposits")
    .select("id, type, status, amount_usdc, deposit_address, bridge_status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ deposits: [] });
  return NextResponse.json({ deposits: data ?? [] });
}

export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { type, status = "pending", amount_usdc, deposit_address, provider_order_id } = body as {
    type?: string; status?: string; amount_usdc?: number; deposit_address?: string; provider_order_id?: string;
  };

  // Matches the user_deposits_type_check constraint (see supabase/migrations). "card-onramp" and
  // "usdc-wallet" were already sent by BalanceModal.tsx but missing here — every one of those
  // inserts was silently rejected below until this list caught up with the constraint.
  if (!type || !["blink", "near-intents", "coinbase", "moonpay", "card-onramp", "usdc-wallet", "peer-pay"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  if (amount_usdc !== undefined && amount_usdc !== null && !validAmount(amount_usdc)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let finalStatus = "pending";
  if (status === "complete" && type === "blink" && validAmount(amount_usdc)) {
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await supabase
      .from("user_deposits")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("type", "blink")
      .eq("status", "complete")
      .gte("created_at", since);
    if ((count ?? 0) < MAX_BLINK_COMPLETE_PER_DAY) finalStatus = "complete";
  } else if (CLIENT_OPEN_STATUSES.has(String(status))) {
    finalStatus = "pending";
  }
  const { data, error } = await supabase
    .from("user_deposits")
    .insert({
      user_id: userId, type, status: finalStatus,
      amount_usdc: amount_usdc ?? null,
      deposit_address: deposit_address ?? null,
      provider_order_id: provider_order_id ?? null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function PATCH(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { id, status, bridge_status } = body as {
    id?: string; status?: string; bridge_status?: string; amount_usdc?: number;
  };

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  // A client can close a deposit it opened, never complete it and never change its amount.
  if (status && !CLIENT_CLOSE_STATUSES.has(status)) {
    return NextResponse.json({ error: "Status can't be set from the client" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (bridge_status !== undefined) updates.bridge_status = bridge_status;

  const { error } = await supabase
    .from("user_deposits")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
