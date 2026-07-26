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
  const type = searchParams.get("type") ?? ""; // "near-intents" | "usdc" | ""

  let query = supabase
    .from("withdrawals")
    .select(
      "id, created_at, user_id, amount_usdc, tx_signature, destination_address, destination_chain, destination_token, is_near_intents, estimated_out, near_intents_status, near_intents_complete, is_devnet",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (type === "near-intents") query = query.eq("is_near_intents", true);
  if (type === "usdc") query = query.eq("is_near_intents", false);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];

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

  const enriched = rows.map((r: any) => ({ ...r, user: userMap[r.user_id] ?? null }));

  return NextResponse.json({ data: enriched, total: count ?? 0, page, limit: PAGE_SIZE });
}
