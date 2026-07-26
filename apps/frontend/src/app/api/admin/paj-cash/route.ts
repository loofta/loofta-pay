import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const status = searchParams.get("status") ?? "";
  const direction = searchParams.get("direction") ?? "";

  let query = supabase
    .from("paj_cash_orders")
    .select(
      "id, created_at, user_id, direction, currency, fiat_amount, amount_usdc, rate, fee_usdc, status, onramp_bank_name, onramp_account_number, offramp_bank_account_id, offramp_tx_signature, error_message, completed_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status.toUpperCase());
  if (direction) query = query.eq("direction", direction.toUpperCase());

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit: PAGE_SIZE });
}
