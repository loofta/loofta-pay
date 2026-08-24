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

  // Ticket total for the current filter: a row can represent several tickets bought in one
  // purchase, so `count` (row count, used for pagination) understates real tickets sold/gifted.
  // Sum num_tickets across all matching rows instead for the total shown to the admin.
  let ticketsTotalQuery = supabase.from("lottery_tickets").select("num_tickets");
  if (status) ticketsTotalQuery = ticketsTotalQuery.eq("status", status);
  const { data: ticketsTotalRows } = await ticketsTotalQuery;
  const totalTickets = (ticketsTotalRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.num_tickets) || 0), 0);

  // Active tickets total: sum of num_tickets across every row currently in the live/undrawn
  // round — a row can represent several tickets bought in one purchase, so this is a sum, not
  // a row count. Not scoped to "today" — a ticket bought yesterday is still active until drawn.
  const { data: activeRows } = await supabase
    .from("lottery_tickets")
    .select("num_tickets")
    .eq("status", "active");
  const activeTicketsTotal = (activeRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.num_tickets) || 0), 0);

  // Revenue today: Loofta's actual fee take (not gross ticket sales) for tickets created since
  // UTC midnight.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: todayRows } = await supabase
    .from("lottery_tickets")
    .select("fee_amount_usdc")
    .gte("created_at", todayStart.toISOString());
  const revenueToday = (todayRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.fee_amount_usdc) || 0), 0);

  return NextResponse.json({ data: enriched, total: count ?? 0, totalTickets, page, limit: PAGE_SIZE, activeTicketsTotal, revenueToday });
}
