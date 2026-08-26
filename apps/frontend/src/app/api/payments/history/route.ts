import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isNonMainnetCluster } from "@/lib/solanaCluster";
import { getVerifiedSolanaWallets } from "@/lib/serverAuth";

// recipient_address included only to detect PENDING_* prefixes — real wallet addresses are stripped in normalisePayment
const PAYMENT_SELECT =
  "id, short_id, amount, direction, status, created_at, paid_at, recipient_username, sender_user_id, recipient_user_id, recipient_email, recipient_address, created_by, from_chain, from_token, to_chain, to_token, description, is_devnet, is_private, claimed_privately, guest_sender_email";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const OPEN_PAYMENT_EXPIRY_DAYS = 7;

export type PaymentHistoryClaim = {
  id: string;
  short_id?: string | null;
  amount: string;
  direction: "from_sender" | "from_recipient";
  // What sender paid with
  from_chain: string | null;
  from_token: string | null;
  // What recipient receives
  to_chain: string;
  to_token: string;
  // Compat aliases
  to_symbol: string;
  paid_with_chain: string | null;
  paid_with_token: string | null;
  is_private: boolean | null;
  claimed_privately?: boolean | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  recipient_username?: string | null;
  recipient_email?: string | null;
  recipient_address?: string;
  creator_email: string | null;
  creator_username?: string | null;
  created_by: string | null;
  description: string | null;
  is_devnet?: boolean;
  /** Set only for a from_recipient payment (checkout/payment-link) paid by a guest with no Loofta
   *  account — see the guest_sender_email migration comment. Stored purely for display; never used
   *  to verify identity, and no account-linking reconciliation reads it (not built yet). */
  guest_sender_email?: string | null;
};

const TERMINAL_STATUSES = ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CANCELLED", "REFUNDED", "EXPIRED", "DELETED"];
const RECEIVED_VISIBLE_STATUSES = ["SUCCESS", "PRIVATE_TRANSFER_PENDING"];
// Only columns the totals queries need — keeps the unpaginated fetch light regardless of how
// many rows a sender/recipient has accumulated.
const TOTAL_SELECT = "id, amount, status, paid_at";

/** A row counts toward "amount sent"/"amount received" once funds have actually moved — SUCCESS,
 *  or PRIVATE_TRANSFER_PENDING with paid_at set (sent but not yet claimed by the recipient).
 *  Mirrors the frontend's countsTowardTotal so the summary card and the row list agree. */
function sumCountedAmount(rows: { amount: unknown; status: unknown; paid_at: unknown }[]): number {
  return rows.reduce((sum, r) => {
    const status = String(r.status ?? "").toUpperCase();
    const counts = status === "SUCCESS" || (status === "PRIVATE_TRANSFER_PENDING" && !!r.paid_at);
    return counts ? sum + parseFloat(String(r.amount ?? "0")) : sum;
  }, 0);
}

function isExpiredOpenPayment(p: { status: string; created_at: string }): boolean {
  const status = String(p.status || "").toUpperCase();
  if (TERMINAL_STATUSES.includes(status)) return false;
  const cutoff = Date.now() - OPEN_PAYMENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return new Date(p.created_at).getTime() < cutoff;
}

/** Normalise a payments row to the shared PaymentHistoryClaim shape. */
function normalisePayment(row: Record<string, unknown>): PaymentHistoryClaim & { _recipient_user_id?: string | null } {
  const rawStatus = String(row.status ?? "");
  // Rows matched via the recipient's own pending username/email (see pendingAddresses below) are
  // funded (SUCCESS) but the money is still sitting in the burner — the recipient hasn't swept it
  // to their wallet yet by going through /c/[id]. Report them as PRIVATE_TRANSFER_PENDING, which
  // every locale already renders as "Unclaimed" with an amber badge, instead of a misleading "Paid".
  const displayStatus = row._pendingUnclaimed && rawStatus.toUpperCase() === "SUCCESS"
    ? "PRIVATE_TRANSFER_PENDING"
    : rawStatus;
  return {
    id: String(row.id ?? ""),
    short_id: (row.short_id as string | null) ?? null,
    amount: String(row.amount ?? "0"),
    direction: (row.direction as "from_sender" | "from_recipient") ?? "from_sender",
    to_symbol: "USDC",
    to_chain: (row.to_chain as string) || "solana",
    to_token: (row.to_token as string) || "USDC",
    from_chain: (row.from_chain as string | null) ?? null,
    from_token: (row.from_token as string | null) ?? null,
    // compat aliases
    paid_with_chain: (row.from_chain as string | null) ?? null,
    paid_with_token: (row.from_token as string | null) ?? null,
    status: displayStatus,
    created_at: String(row.created_at ?? ""),
    paid_at: (row.paid_at as string | null) ?? null,
    recipient_username: (row.recipient_username as string | null) ?? null,
    recipient_email: (row.recipient_email as string | null) ?? null,
    // Only expose recipient_address for PENDING_* values — real wallet addresses stay hidden
    recipient_address: (() => {
      const addr = String(row.recipient_address ?? "").trim();
      return addr.startsWith("PENDING_EMAIL:") || addr.startsWith("PENDING_USERNAME:") || addr.startsWith("PENDING_SOCIAL:") ? addr : undefined;
    })(),
    creator_email: null,
    created_by: (row.created_by as string | null) ?? null,
    is_private: (row.is_private as boolean | null) ?? null,
    claimed_privately: Boolean(row.claimed_privately),
    description: (row.description as string | null) ?? null,
    is_devnet: Boolean(row.is_devnet),
    guest_sender_email: (row.guest_sender_email as string | null) ?? null,
    _recipient_user_id: (row.recipient_user_id as string | null) ?? null,
  };
}

async function getVerifiedUserId(request: Request): Promise<string | null> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const res = await fetch(`${backendUrl}/users/me`, {
      headers: { authorization: authHeader },
    });
    if (res.ok) {
      const data = await res.json();
      return data.userId ?? null;
    }
  } catch (e) {
    console.warn("[payments/history] Backend verify failed:", e);
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const userId = await getVerifiedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT), 10);
    const limit = Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT);
    const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10), 1);
    const offset = (page - 1) * limit;

    const daysBack = parseInt(searchParams.get("days") ?? "0", 10);
    const dateFilter = daysBack > 0
      ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
      : null;

    let walletAddresses: string[] = (searchParams.get("walletAddresses") || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    // walletAddresses is client-supplied — never trust it as-is, or any authenticated user could
    // read another wallet's received-payment history (amounts, senders, descriptions) by passing
    // an address they don't own. Only keep addresses that are actually this user's own live,
    // Privy-verified Solana wallets.
    if (walletAddresses.length > 0) {
      const ownWallets = new Set(await getVerifiedSolanaWallets(userId));
      walletAddresses = walletAddresses.filter((a) => ownWallets.has(a));
    }

    if (walletAddresses.length === 0) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const authHeader = request.headers.get("authorization");
      try {
        const res = await fetch(`${backendUrl}/users/me/wallet/balance`, {
          headers: authHeader ? { authorization: authHeader } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data.walletAddress) walletAddresses = [data.walletAddress];
        }
      } catch (e) {
        console.warn("[payments/history] Failed to get wallet from backend:", e);
      }
    }

    const supabase = getSupabaseAdmin();
    const networkParam = searchParams.get("network");
    const devnetOnly = networkParam ? networkParam !== "mainnet" : isNonMainnetCluster();

                                                                                                  // Look up current user's username/email/twitter so we can find payments sent to them as
    // pending recipients. Mirrors the fallback in ClaimsService.checkIsRecipient: a
    // PENDING_USERNAME:<value> row may have been addressed to either the recipient's Loofta
    // username or their X handle (the sender doesn't know which one they'll end up with), so
    // both must be checked here too — otherwise a payment the recipient can already claim via
    // the direct link (checkIsRecipient) silently never appears in their history list.
    const { data: currentUser } = await supabase
      .from("app_users")
      .select("username, email, twitter_username")
      .eq("privy_user_id", userId)
      .maybeSingle();
    const pendingAddresses: string[] = [];
    if (currentUser?.username) pendingAddresses.push(`PENDING_USERNAME:${currentUser.username.toLowerCase()}`);
    if (currentUser?.twitter_username) {
      const cleanTwitter = currentUser.twitter_username.replace(/^@/, "").toLowerCase();
      const handle = `PENDING_USERNAME:${cleanTwitter}`;
      if (!pendingAddresses.includes(handle)) pendingAddresses.push(handle);
      // A payment sent explicitly via the "Twitter" option in the social picker (not the plain
      // username field) is stored as PENDING_SOCIAL:twitter:<handle>, not PENDING_USERNAME:<handle>
      // (see ClaimsService's treatUnregisteredAsTwitter branch) — must check both shapes or those
      // payments never surface here even once the recipient connects the exact matching X account.
      const socialHandle = `PENDING_SOCIAL:twitter:${cleanTwitter}`;
      if (!pendingAddresses.includes(socialHandle)) pendingAddresses.push(socialHandle);
    }
    if (currentUser?.email) pendingAddresses.push(`PENDING_EMAIL:${currentUser.email.toLowerCase()}`);
    // Same fallback for Discord/GitHub/Telegram — a payment sent to a handle before it was
    // connected must still surface here once the matching social_accounts row exists.
    const { data: socialAccounts } = await supabase
      .from("social_accounts")
      .select("platform, handle")
      .eq("user_id", userId);
    for (const row of (socialAccounts || []) as { platform: string; handle: string }[]) {
      pendingAddresses.push(`PENDING_SOCIAL:${row.platform}:${row.handle.toLowerCase()}`);
    }

    // ── payments table (new records) ──────────────────────────────────────
    // Sent: payments where this user is the sender (new schema)
    let sentPaymentsQuery = supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("sender_user_id", userId)
      .eq("is_devnet", devnetOnly)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (dateFilter) sentPaymentsQuery = sentPaymentsQuery.gte("created_at", dateFilter);
    const { data: sentPaymentRows } = await sentPaymentsQuery;

    // Legacy fallback: payments created by user where sender_user_id not yet backfilled
    let legacySentQuery = supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("created_by", userId)
      .is("sender_user_id", null)
      .not("direction", "eq", "from_recipient")
      .eq("is_devnet", devnetOnly)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (dateFilter) legacySentQuery = legacySentQuery.gte("created_at", dateFilter);
    const { data: legacySentRows } = await legacySentQuery;

    // Open/pending payment request links (from_recipient, not yet paid → sender_user_id is null)
    let pendingRequestsQuery = supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("created_by", userId)
      .eq("direction", "from_recipient")
      .not("status", "in", `(${RECEIVED_VISIBLE_STATUSES.join(",")})`)
      .eq("is_devnet", devnetOnly)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (dateFilter) pendingRequestsQuery = pendingRequestsQuery.gte("created_at", dateFilter);
    const { data: pendingRequestRows } = await pendingRequestsQuery;

    // Received: payments where this user is the recipient (by stable ID or by wallet address)
    let recByIdQuery = supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("recipient_user_id", userId)
      .in("status", RECEIVED_VISIBLE_STATUSES)
      .eq("is_devnet", devnetOnly)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (dateFilter) recByIdQuery = recByIdQuery.gte("created_at", dateFilter);
    const { data: recByIdRows } = await recByIdQuery;

    let receivedPaymentRows: Record<string, unknown>[] = (recByIdRows || []) as Record<string, unknown>[];
    if (walletAddresses.length > 0) {
      let recByWalletQuery = supabase
        .from("payments")
        .select(PAYMENT_SELECT)
        .in("recipient_address", walletAddresses)
        .in("status", RECEIVED_VISIBLE_STATUSES)
        .eq("is_devnet", devnetOnly)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (dateFilter) recByWalletQuery = recByWalletQuery.gte("created_at", dateFilter);
      const { data: recByWallet } = await recByWalletQuery;
      const seen = new Set(receivedPaymentRows.map((r) => r.id as string));
      for (const r of (recByWallet || []) as Record<string, unknown>[]) {
        if (!seen.has(r.id as string)) receivedPaymentRows.push(r);
      }
    }

    // Payments sent to this user by pending username/email (unclaimed — recipient_user_id not yet set)
    if (pendingAddresses.length > 0) {
      let recByPendingQuery = supabase
        .from("payments")
        .select(PAYMENT_SELECT)
        .in("recipient_address", pendingAddresses)
        .in("status", RECEIVED_VISIBLE_STATUSES)
        .eq("is_devnet", devnetOnly)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (dateFilter) recByPendingQuery = recByPendingQuery.gte("created_at", dateFilter);
      const { data: recByPending } = await recByPendingQuery;
      const seen = new Set(receivedPaymentRows.map((r) => r.id as string));
      for (const r of (recByPending || []) as Record<string, unknown>[]) {
        if (!seen.has(r.id as string)) receivedPaymentRows.push({ ...r, _pendingUnclaimed: true });
      }
    }

    // ── True totals for the summary cards (unpaginated) ─────────────────────
    // The lists above are paginated (DEFAULT_PAGE_LIMIT rows) for display — summing only the
    // fetched page silently understated "amount sent"/"amount received" for anyone with more
    // than a page of history (e.g. a multi-send campaign creating 100+ individual rows). These
    // run the same filters with no .range(), fetching only the columns sumCountedAmount needs.
    let sentTotalQuery = supabase
      .from("payments")
      .select(TOTAL_SELECT)
      .eq("sender_user_id", userId)
      .eq("is_devnet", devnetOnly);
    if (dateFilter) sentTotalQuery = sentTotalQuery.gte("created_at", dateFilter);
    const { data: sentTotalRows } = await sentTotalQuery;

    let legacySentTotalQuery = supabase
      .from("payments")
      .select(TOTAL_SELECT)
      .eq("created_by", userId)
      .is("sender_user_id", null)
      .not("direction", "eq", "from_recipient")
      .eq("is_devnet", devnetOnly);
    if (dateFilter) legacySentTotalQuery = legacySentTotalQuery.gte("created_at", dateFilter);
    const { data: legacySentTotalRows } = await legacySentTotalQuery;

    let recTotalByIdQuery = supabase
      .from("payments")
      .select(TOTAL_SELECT)
      .eq("recipient_user_id", userId)
      .in("status", RECEIVED_VISIBLE_STATUSES)
      .eq("is_devnet", devnetOnly);
    if (dateFilter) recTotalByIdQuery = recTotalByIdQuery.gte("created_at", dateFilter);
    const { data: recTotalByIdRows } = await recTotalByIdQuery;

    const receivedTotalRows: { id: string; amount: unknown; status: unknown; paid_at: unknown }[] =
      (recTotalByIdRows || []) as typeof receivedTotalRows;
    const receivedTotalSeen = new Set(receivedTotalRows.map((r) => r.id));

    if (walletAddresses.length > 0) {
      let recTotalByWalletQuery = supabase
        .from("payments")
        .select(TOTAL_SELECT)
        .in("recipient_address", walletAddresses)
        .in("status", RECEIVED_VISIBLE_STATUSES)
        .eq("is_devnet", devnetOnly);
      if (dateFilter) recTotalByWalletQuery = recTotalByWalletQuery.gte("created_at", dateFilter);
      const { data: recTotalByWallet } = await recTotalByWalletQuery;
      for (const r of (recTotalByWallet || []) as typeof receivedTotalRows) {
        if (!receivedTotalSeen.has(r.id)) { receivedTotalSeen.add(r.id); receivedTotalRows.push(r); }
      }
    }

    if (pendingAddresses.length > 0) {
      let recTotalByPendingQuery = supabase
        .from("payments")
        .select(TOTAL_SELECT)
        .in("recipient_address", pendingAddresses)
        .in("status", RECEIVED_VISIBLE_STATUSES)
        .eq("is_devnet", devnetOnly);
      if (dateFilter) recTotalByPendingQuery = recTotalByPendingQuery.gte("created_at", dateFilter);
      const { data: recTotalByPending } = await recTotalByPendingQuery;
      for (const r of (recTotalByPending || []) as typeof receivedTotalRows) {
        if (!receivedTotalSeen.has(r.id)) { receivedTotalSeen.add(r.id); receivedTotalRows.push(r); }
      }
    }

    const sentTotal = sumCountedAmount([...(sentTotalRows || []), ...(legacySentTotalRows || [])]);
    const receivedTotal = sumCountedAmount(receivedTotalRows);

    // Normalise and merge; deduplicate by ID (payments table takes precedence)
    const normPaymentReceived = receivedPaymentRows.map((r) => normalisePayment(r));
    const sentIds = new Set((sentPaymentRows || []).map((r) => (r as Record<string, unknown>).id as string));
    const normPaymentSent = [
      ...(sentPaymentRows || []).map((r) => normalisePayment(r as Record<string, unknown>)),
      // Legacy: created_by match, sender_user_id not yet backfilled
      ...(legacySentRows || [])
        .filter((r) => !sentIds.has((r as Record<string, unknown>).id as string))
        .map((r) => normalisePayment(r as Record<string, unknown>)),
      // Open/pending request links (sender_user_id null until paid)
      ...(pendingRequestRows || [])
        .filter((r) => !sentIds.has((r as Record<string, unknown>).id as string))
        .map((r) => normalisePayment(r as Record<string, unknown>)),
    ];

    const allItems = [...normPaymentSent, ...normPaymentReceived];

    // Enrich with usernames — collect created_by, sender_user_id, and recipient_user_id in one batch
    type EnrichedClaim = PaymentHistoryClaim & { sender_user_id?: string | null; _recipient_user_id?: string | null };
    const allUserIds = [...new Set([
      ...allItems.map((c) => c.created_by),
      ...allItems.map((c) => (c as EnrichedClaim).sender_user_id ?? null),
      ...allItems.map((c) => (c as EnrichedClaim)._recipient_user_id ?? null),
    ].filter(Boolean))] as string[];
    let usernameMap: Record<string, string> = {};
    if (allUserIds.length > 0) {
      const { data: users } = await supabase
        .from("app_users")
        .select("privy_user_id, username")
        .in("privy_user_id", allUserIds);
      if (users) {
        usernameMap = Object.fromEntries(
          users
            .filter((u) => u.privy_user_id && u.username != null)
            .map((u) => [u.privy_user_id!, u.username!]),
        );
      }
    }

    const enrich = (c: PaymentHistoryClaim) => {
      const ec = c as EnrichedClaim;
      // Only backfill from recipient_user_id for from_sender payments.
      // from_recipient (payment request links) store the creator's own ID in recipient_user_id,
      // so backfilling there would show the creator's own username as the payee.
      // Live lookup wins over the column stored at send time — a recipient addressed directly by
      // username (claims.service.ts createFromUsername) gets that value frozen on the row, so
      // without this a later username switch (switch-username route) would leave "Send again"
      // targeting a stale handle that no longer resolves to anyone, instead of their current one.
      const recipientUsername =
        (c.direction === "from_sender" && ec._recipient_user_id && usernameMap[ec._recipient_user_id]) ||
        c.recipient_username ||
        null;
      const creatorUsername = (c.created_by && usernameMap[c.created_by]) || null;
      const senderUsername = (ec.sender_user_id && usernameMap[ec.sender_user_id]) || null;
      // created_by/sender_user_id/_recipient_user_id are raw Privy user IDs used only to look up
      // display usernames above — never send them to the client.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _recipient_user_id: _dropped, created_by: _droppedCreatedBy, sender_user_id: _droppedSenderUserId, ...rest } = ec;
      return {
        ...rest,
        recipient_username: recipientUsername,
        creator_username: creatorUsername,
        sender_username: senderUsername,
      };
    };

    const sent = normPaymentSent
      .map(enrich)
      .filter((c) => !isExpiredOpenPayment(c) && String(c.status || "").toUpperCase() !== "DELETED");

    const received = normPaymentReceived
      .map(enrich)
      .filter((c) => RECEIVED_VISIBLE_STATUSES.includes(String(c.status || "").toUpperCase()));

    const res = NextResponse.json({ sent, received, page, limit, sentTotal, receivedTotal });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to fetch payment history";
    console.error("[payments/history]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
