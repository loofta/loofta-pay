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
  const platform = searchParams.get("platform") ?? "";

  let query = supabase
    .from("offramp_requests")
    .select(
      "id, created_at, updated_at, user_id, platform, platform_identifier, currency, amount_usdc, status, zkp2p_deposit_id, zkp2p_tx_hash, access_policy_tx_hash, eta_seconds, eta_label, near_intents_deposit_address, completed_at, cancelled_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status.toUpperCase());
  if (platform) query = query.eq("platform", platform.toLowerCase());

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit: PAGE_SIZE });
}
