import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

/** Every wallet top-up order (card, bank, bridge, Peer payment apps), newest first, with who made it. */
export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_deposits")
    .select("id, user_id, type, status, amount_usdc, deposit_address, bridge_status, provider_order_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = Array.from(new Set((data ?? []).map((d: any) => d.user_id).filter(Boolean)));
  const { data: users } = ids.length
    ? await supabase.from("app_users").select("privy_user_id, username, email").in("privy_user_id", ids)
    : { data: [] as any[] };
  const byId = new Map((users ?? []).map((u: any) => [u.privy_user_id, u]));

  const deposits = (data ?? []).map((d: any) => {
    const u = byId.get(d.user_id) as any;
    return { ...d, username: u?.username ?? null, email: u?.email ?? null };
  });
  return NextResponse.json({ deposits });
}
