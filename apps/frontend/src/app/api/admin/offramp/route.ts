import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { attachUsers } from "@/lib/adminUsers";

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

  // short_id is optional until migration 20261011190000 is applied; retry without it if missing.
  const baseCols =
    "id, created_at, updated_at, user_id, platform, platform_identifier, currency, amount_usdc, status, zkp2p_deposit_id, zkp2p_tx_hash, access_policy_tx_hash, eta_seconds, eta_label, filled_amount_usdc, fill_state, near_intents_deposit_address, near_intents_status, completed_at, cancelled_at";
  const run = (cols: string) => {
    let q = supabase
      .from("offramp_requests")
      .select(cols, { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (status) q = q.eq("status", status.toUpperCase());
    if (platform) q = q.eq("platform", platform.toLowerCase());
    return q;
  };

  let { data, count, error } = await run(`${baseCols}, short_id`);
  if (error && /short_id/i.test(error.message ?? "")) ({ data, count, error } = await run(baseCols));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Older rows without the column keep their share code on near_intents_status as "sid:<code>".
  const rows = ((data ?? []) as any[]).map((r) => ({
    ...r,
    short_id: r.short_id ?? (typeof r.near_intents_status === "string" && r.near_intents_status.startsWith("sid:") ? r.near_intents_status.slice(4) : null),
  }));

  return NextResponse.json({ data: await attachUsers(rows), total: count ?? 0, page, limit: PAGE_SIZE });
}
