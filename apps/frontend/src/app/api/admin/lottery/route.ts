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

  let query = supabase
    .from("lottery_tickets")
    .select(
      "id, created_at, updated_at, user_id, num_tickets, cost_usdc, status, round_id, draw_time, win_amount_usdc, win_tier, burner_sol_address, companion_address, user_solana_address, sender_tx_hash, claim_tx_hash, bridge_status, ticket_numbers, winning_numbers, fee_amount_usdc",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickets = data ?? [];
  const userIds = [...new Set(tickets.map((t: any) => t.user_id).filter(Boolean))];

  const userMap: Record<string, { username: string | null; email: string | null }> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("privy_user_id, username, email")
      .in("privy_user_id", userIds);
    for (const u of users ?? []) {
      userMap[(u as any).privy_user_id] = { username: (u as any).username, email: (u as any).email };
    }
  }

  const enriched = tickets.map((t: any) => ({ ...t, user: userMap[t.user_id] ?? null }));

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit: PAGE_SIZE });
}
