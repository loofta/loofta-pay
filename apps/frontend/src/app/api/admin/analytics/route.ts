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
    appUsersRes,
    offrampRes,
    pajOfframpRes,
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
    // actually completed a purchase (active/won/lost/withdrawn) — pending/bridging tickets
    // haven't committed the spend yet, and failed tickets get refunded. "withdrawn" is a later
    // terminal status reached from "won" once a payout is claimed/replayed, not a refund — it
    // must stay included or every cashed-out winning ticket silently drops out of the totals.
    supabase
      .from("lottery_tickets")
      .select("cost_usdc, user_id, num_tickets")
      .in("status", ["active", "won", "lost", "withdrawn"])
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
    supabase
      .from("app_users")
      .select("privy_user_id, username, email")
      .limit(100000),
    // Cash outs (Venmo/Cash App/Revolut/etc via Peer) — only completed ones moved real money out.
    supabase
      .from("offramp_requests")
      .select("amount_usdc")
      .eq("status", "COMPLETE")
      .limit(100000),
    // Naira cash outs via PAJ Cash.
    supabase
      .from("paj_cash_orders")
      .select("amount_usdc")
      .eq("direction", "OFF_RAMP")
      .eq("status", "COMPLETE")
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
  const mainnetAbove5 = (mainnetSuccessRes.data ?? []).filter((p: any) => Number(p.amount) > 5);
  const tx_mainnet_success_above_5 = mainnetAbove5.length;

  const above5BySender = new Map<string, { txCount: number; totalAmount: number }>();
  mainnetAbove5.forEach((p: any) => {
    if (!p.sender_user_id) return;
    const entry = above5BySender.get(p.sender_user_id) ?? { txCount: 0, totalAmount: 0 };
    entry.txCount += 1;
    entry.totalAmount += Number(p.amount);
    above5BySender.set(p.sender_user_id, entry);
  });
  const users_mainnet_success_above_5 = above5BySender.size;

  const appUsersById = new Map(
    (appUsersRes.data ?? []).map((u: any) => [u.privy_user_id, u])
  );
  const users_mainnet_success_above_5_list = Array.from(above5BySender.entries())
    .map(([privyUserId, stats]) => {
      const u = appUsersById.get(privyUserId) as any;
      return {
        privyUserId,
        username: u?.username ?? null,
        email: u?.email ?? null,
        txCount: stats.txCount,
        totalAmount: stats.totalAmount,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // Repeat senders: more than 2 successful payments total, any amount (not filtered to > $5 —
  // a sender with 3+ smaller payments should still show up here).
  const bySender = new Map<string, { txCount: number; totalAmount: number }>();
  (mainnetSuccessRes.data ?? []).forEach((p: any) => {
    if (!p.sender_user_id) return;
    const entry = bySender.get(p.sender_user_id) ?? { txCount: 0, totalAmount: 0 };
    entry.txCount += 1;
    entry.totalAmount += Number(p.amount);
    bySender.set(p.sender_user_id, entry);
  });
  const users_mainnet_success_above_5_repeat_list = Array.from(bySender.entries())
    .filter(([, stats]) => stats.txCount > 2)
    .map(([privyUserId, stats]) => {
      const u = appUsersById.get(privyUserId) as any;
      return {
        privyUserId,
        username: u?.username ?? null,
        email: u?.email ?? null,
        txCount: stats.txCount,
        totalAmount: stats.totalAmount,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
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
  // Each row is one purchase event but can cover multiple tickets — sum num_tickets,
  // not row count, to get the actual ticket total.
  const tx_lottery_count = (lotteryRes.data ?? []).reduce(
    (acc: number, t: any) => acc + Number(t.num_tickets ?? 1),
    0
  );
  const users_lottery = new Set(
    (lotteryRes.data ?? []).map((t: any) => t.user_id).filter(Boolean)
  ).size;
  // Repeat buyers: distinct users with more than one completed purchase row (a row is one
  // purchase event, which can itself cover multiple tickets via num_tickets).
  const lotteryPurchasesByUser = new Map<string, number>();
  (lotteryRes.data ?? []).forEach((t: any) => {
    if (!t.user_id) return;
    lotteryPurchasesByUser.set(t.user_id, (lotteryPurchasesByUser.get(t.user_id) ?? 0) + 1);
  });
  const lottery_repeat_buyers = Array.from(lotteryPurchasesByUser.values()).filter((c) => c > 1).length;
  const lottery_one_time_buyers = lotteryPurchasesByUser.size - lottery_repeat_buyers;
  const volume_deposits = sum(depositsRes.data, "amount_usdc");
  const volume_withdrawals_devnet = sumCompletedWithdrawals(withdrawalsDevnetRes.data);
  const volume_withdrawals_mainnet = sumCompletedWithdrawals(withdrawalsMainnetRes.data);

  const volume_cashouts = sum(offrampRes.data, "amount_usdc") + sum(pajOfframpRes.data, "amount_usdc");
  const tx_cashouts_count = (offrampRes.data?.length ?? 0) + (pajOfframpRes.data?.length ?? 0);

  const payload = {
    volume_devnet,
    volume_mainnet,
    volume_devnet_total,
    volume_mainnet_total,
    tx_devnet_success: devnetSuccessRes.data?.length ?? 0,
    tx_mainnet_success: mainnetSuccessRes.data?.length ?? 0,
    tx_mainnet_success_above_5,
    users_mainnet_success_above_5,
    users_mainnet_success_above_5_list,
    users_mainnet_success_above_5_repeat_list,
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
    tx_lottery_count,
    users_lottery,
    lottery_repeat_buyers,
    lottery_one_time_buyers,
    volume_deposits,
    tx_deposits_count: depositsRes.data?.length ?? 0,
    volume_withdrawals_devnet,
    volume_withdrawals_mainnet,
    volume_cashouts,
    tx_cashouts_count,
    tx_withdrawals_devnet_count: withdrawalsDevnetRes.data?.length ?? 0,
    tx_withdrawals_mainnet_count: withdrawalsMainnetRes.data?.length ?? 0,
    // Overall platform volume including lottery, deposits, and withdrawals alongside payments —
    // matches the ask to fold lottery into the headline volume number.
    volume_total_all: volume_mainnet + volume_lottery + volume_deposits + volume_withdrawals_mainnet + volume_cashouts,
  };

  return NextResponse.json(payload, {
    headers: {
      // Cache for 60 s on the edge, serve stale for up to 5 min while revalidating
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}
