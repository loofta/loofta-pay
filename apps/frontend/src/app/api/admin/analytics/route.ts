import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const [
    devnetSuccessRes,
    mainnetSuccessRes,
    devnetAllAmountsRes,
    mainnetAllAmountsRes,
    devnetTotalRes,
    mainnetTotalRes,
    totalUsersRes,
    usersWithEmailRes,
    waitlistTotalRes,
    waitlistGrantedRes,
    waitlistWithTwitterRes,
  ] = await Promise.all([
    supabase
      .from("payments")
      .select("amount")
      .eq("is_devnet", true)
      .eq("status", "SUCCESS")
      .limit(100000),
    supabase
      .from("payments")
      .select("amount")
      .eq("is_devnet", false)
      .eq("status", "SUCCESS")
      .limit(100000),
    supabase
      .from("payments")
      .select("amount")
      .eq("is_devnet", true)
      .limit(100000),
    supabase
      .from("payments")
      .select("amount")
      .eq("is_devnet", false)
      .limit(100000),
    supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("is_devnet", true),
    supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("is_devnet", false),
    supabase
      .from("app_users")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .not("email", "is", null)
      .neq("email", ""),
    supabase
      .from("mainnet_waitlist")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("mainnet_waitlist")
      .select("id", { count: "exact", head: true })
      .eq("mainnet_access", true),
    supabase
      .from("mainnet_waitlist")
      .select("id", { count: "exact", head: true })
      .not("twitter_username", "is", null)
      .neq("twitter_username", ""),
  ]);

  const sum = (rows: any[] | null) =>
    (rows ?? []).reduce((acc: number, p: any) => acc + Number(p.amount), 0);

  const volume_devnet = sum(devnetSuccessRes.data);
  const volume_mainnet = sum(mainnetSuccessRes.data);
  const volume_devnet_total = sum(devnetAllAmountsRes.data);
  const volume_mainnet_total = sum(mainnetAllAmountsRes.data);

  const payload = {
    volume_devnet,
    volume_mainnet,
    volume_devnet_total,
    volume_mainnet_total,
    tx_devnet_success: devnetSuccessRes.data?.length ?? 0,
    tx_mainnet_success: mainnetSuccessRes.data?.length ?? 0,
    tx_devnet_total: devnetTotalRes.count ?? 0,
    tx_mainnet_total: mainnetTotalRes.count ?? 0,
    total_users: totalUsersRes.count ?? 0,
    users_with_email: usersWithEmailRes.count ?? 0,
    waitlist_total: waitlistTotalRes.count ?? 0,
    waitlist_granted: waitlistGrantedRes.count ?? 0,
    waitlist_with_twitter: waitlistWithTwitterRes.count ?? 0,
  };

  return NextResponse.json(payload, {
    headers: {
      // Cache for 60 s on the edge, serve stale for up to 5 min while revalidating
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}
