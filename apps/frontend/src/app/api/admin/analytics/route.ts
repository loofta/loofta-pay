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
    mainnetAllStatusRes,
    totalUsersRes,
    usersWithEmailRes,
    waitlistTotalRes,
    waitlistGrantedRes,
    waitlistWithTwitterRes,
    lotteryRes,
    depositsRes,
    withdrawalsDevnetRes,
    withdrawalsMainnetRes,
  ] = await Promise.all([
    supabase
      .from("payments")
      .select("amount")
      .eq("is_devnet", true)
      .eq("status", "SUCCESS")
      .limit(100000),
    // sender_user_id/recipient_user_id also feed the mainnet active/repeat user counts below.
    supabase
      .from("payments")
      .select("amount, sender_user_id, recipient_user_id")
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
    // Every mainnet payment link, any status — the raw material for the signup → link → funded →
    // success funnel below. Superset of the mainnet total count, so it replaces that head-count query.
    supabase
      .from("payments")
      .select("status, sender_user_id")
      .eq("is_devnet", false)
      .limit(100000),
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
    // Lottery (Megapot) — mainnet-only feature, no devnet split. Only count tickets that
    // actually completed a purchase (active/won/lost) — pending/bridging tickets haven't
    // committed the spend yet, and failed tickets get refunded.
    supabase
      .from("lottery_tickets")
      .select("cost_usdc, user_id")
      .in("status", ["active", "won", "lost"])
      .limit(100000),
    supabase
      .from("user_deposits")
      .select("amount_usdc")
      .eq("status", "complete")
      .limit(100000),
    supabase
      .from("withdrawals")
      .select("amount_usdc, is_near_intents, near_intents_complete")
      .eq("is_devnet", true)
      .limit(100000),
    supabase
      .from("withdrawals")
      .select("amount_usdc, is_near_intents, near_intents_complete")
      .eq("is_devnet", false)
      .limit(100000),
  ]);

  const sum = (rows: any[] | null, key = "amount") =>
    (rows ?? []).reduce((acc: number, p: any) => acc + Number(p[key]), 0);

  // A withdrawal row only ever exists after its on-chain send tx signed & broadcast — direct
  // (non-bridged) withdrawals are done at that point, so they always count. Near-Intents
  // (bridged) withdrawals aren't actually delivered until the bridge leg completes.
  const sumCompletedWithdrawals = (rows: any[] | null) =>
    (rows ?? [])
      .filter((r: any) => !r.is_near_intents || r.near_intents_complete)
      .reduce((acc: number, r: any) => acc + Number(r.amount_usdc), 0);

  const volume_devnet = sum(devnetSuccessRes.data);
  const volume_mainnet = sum(mainnetSuccessRes.data);
  const volume_devnet_total = sum(devnetAllAmountsRes.data);
  const volume_mainnet_total = sum(mainnetAllAmountsRes.data);

  // Per-user mainnet activity count — sender or recipient of a completed private payment, or a
  // completed lottery ticket. Counting (not just a Set) lets us also derive repeat users below.
  const mainnetActivityCounts = new Map<string, number>();
  const bumpMainnetActivity = (id: string | null | undefined) => {
    if (!id) return;
    mainnetActivityCounts.set(id, (mainnetActivityCounts.get(id) ?? 0) + 1);
  };
  (mainnetSuccessRes.data ?? []).forEach((p: any) => {
    bumpMainnetActivity(p.sender_user_id);
    bumpMainnetActivity(p.recipient_user_id);
  });
  (lotteryRes.data ?? []).forEach((t: any) => bumpMainnetActivity(t.user_id));

  const mainnet_active_users = mainnetActivityCounts.size;
  const mainnet_repeat_users = Array.from(mainnetActivityCounts.values()).filter((c) => c > 1).length;

  // Funnel: signed up -> created a payment link -> funded it -> recipient claimed (SUCCESS).
  // "Funded" = the burner actually received funds at some point (anything past OPEN/PENDING_DEPOSIT
  // that isn't EXPIRED/CANCELLED/DELETED) — SUCCESS is a subset of funded, not a separate branch.
  const FUNDED_STATUSES = new Set(["IN_FLIGHT", "FUNDED", "PRIVATE_TRANSFER_PENDING", "SUCCESS", "REFUNDED"]);
  const mainnetLinks = mainnetAllStatusRes.data ?? [];
  const usersCreatedLink = new Set<string>();
  const usersFunded = new Set<string>();
  const usersSuccess = new Set<string>();
  let linksFunded = 0;
  let linksSuccess = 0;
  let linksExpired = 0;
  for (const row of mainnetLinks as any[]) {
    if (row.sender_user_id) usersCreatedLink.add(row.sender_user_id);
    if (FUNDED_STATUSES.has(row.status)) {
      linksFunded++;
      if (row.sender_user_id) usersFunded.add(row.sender_user_id);
    }
    if (row.status === "SUCCESS") {
      linksSuccess++;
      if (row.sender_user_id) usersSuccess.add(row.sender_user_id);
    }
    if (row.status === "EXPIRED") linksExpired++;
  }
  const funnel_mainnet = {
    users_signed_up: totalUsersRes.count ?? 0,
    users_created_link: usersCreatedLink.size,
    users_funded: usersFunded.size,
    users_success: usersSuccess.size,
    links_created: mainnetLinks.length,
    links_funded: linksFunded,
    links_success: linksSuccess,
    links_expired: linksExpired,
  };

  const volume_lottery = sum(lotteryRes.data, "cost_usdc");
  const volume_deposits = sum(depositsRes.data, "amount_usdc");
  const volume_withdrawals_devnet = sumCompletedWithdrawals(withdrawalsDevnetRes.data);
  const volume_withdrawals_mainnet = sumCompletedWithdrawals(withdrawalsMainnetRes.data);

  const payload = {
    volume_devnet,
    volume_mainnet,
    volume_devnet_total,
    volume_mainnet_total,
    tx_devnet_success: devnetSuccessRes.data?.length ?? 0,
    tx_mainnet_success: mainnetSuccessRes.data?.length ?? 0,
    tx_devnet_total: devnetTotalRes.count ?? 0,
    tx_mainnet_total: mainnetLinks.length,
    total_users: totalUsersRes.count ?? 0,
    users_with_email: usersWithEmailRes.count ?? 0,
    // Distinct users who sent OR received a completed mainnet private payment, or bought a lottery ticket.
    mainnet_active_users,
    // Of those, how many show up more than once (any mix of sent/received/lottery).
    mainnet_repeat_users,
    funnel_mainnet,
    waitlist_total: waitlistTotalRes.count ?? 0,
    waitlist_granted: waitlistGrantedRes.count ?? 0,
    waitlist_with_twitter: waitlistWithTwitterRes.count ?? 0,
    volume_lottery,
    tx_lottery_count: lotteryRes.data?.length ?? 0,
    volume_deposits,
    tx_deposits_count: depositsRes.data?.length ?? 0,
    volume_withdrawals_devnet,
    volume_withdrawals_mainnet,
    tx_withdrawals_devnet_count: withdrawalsDevnetRes.data?.length ?? 0,
    tx_withdrawals_mainnet_count: withdrawalsMainnetRes.data?.length ?? 0,
    // Overall platform volume including lottery, deposits, and withdrawals alongside payments —
    // matches the ask to fold lottery into the headline volume number.
    volume_total_all: volume_mainnet + volume_lottery + volume_deposits + volume_withdrawals_mainnet,
  };

  return NextResponse.json(payload, {
    headers: {
      // Cache for 60 s on the edge, serve stale for up to 5 min while revalidating
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}
