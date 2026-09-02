import { NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

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

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_deposits")
    .insert({
      user_id: userId, type, status,
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
  const { id, status, bridge_status, amount_usdc } = body as {
    id?: string; status?: string; bridge_status?: string; amount_usdc?: number;
  };

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (bridge_status !== undefined) updates.bridge_status = bridge_status;
  if (amount_usdc !== undefined) updates.amount_usdc = amount_usdc;

  const { error } = await supabase
    .from("user_deposits")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
