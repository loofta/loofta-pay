import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

const CUTOFF = "2026-04-25T00:00:00.000Z";

const VALID_STATUSES = new Set([
  "OPEN", "PENDING_DEPOSIT", "IN_FLIGHT", "FUNDED",
  "PRIVATE_TRANSFER_PENDING", "SUCCESS", "REFUNDED",
  "EXPIRED", "CANCELLED", "DELETED",
]);

// `search` gets spliced into a PostgREST `.or()` filter string below — a raw comma or paren in
// the value would inject additional filter clauses rather than just matching this search term.
// Double-quoting is PostgREST's own escape mechanism for a value containing reserved characters.
function escapePostgrestFilterValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function GET(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId || !(await isAdmin(privyUserId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const devnetParam = searchParams.get("devnet");
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50")));

  const supabase = getSupabaseAdmin();

  // Resolve sender IDs from app_users username/email search
  let extraSenderIds: string[] = [];
  if (search) {
    const escaped = escapePostgrestFilterValue(`%${search}%`);
    const { data: matchedUsers } = await supabase
      .from("app_users")
      .select("privy_user_id")
      .or(`username.ilike.${escaped},email.ilike.${escaped}`)
      .limit(50);
    extraSenderIds = (matchedUsers ?? [])
      .map((u: any) => u.privy_user_id)
      .filter(Boolean);
  }

  // guest_sender_wallet is optional until migration 20261010160000 is applied.
  // Naming a missing column makes PostgREST fail the whole list (code 42703).
  const optionalColumns = ["guest_sender_wallet"];
  let paymentSelect =
    "id, created_at, updated_at, created_by, sender_user_id, amount, direction, " +
    "recipient_address, recipient_username, recipient_email, burner_address, " +
    "status, paid_at, sender_tx_hash, sweep_tx_hash, description, " +
    "from_chain, from_token, to_chain, to_token, is_devnet, is_private, " +
    "legacy_claim_id, recipient_user_id, expires_at, guest_sender_email, guest_sender_wallet";

  const buildQuery = (select: string) => {
    let query = supabase
      .from("payments")
      .select(select, { count: "exact" })
      .gte("created_at", CUTOFF)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (devnetParam === "true") query = query.eq("is_devnet", true);
    if (devnetParam === "false") query = query.eq("is_devnet", false);
    if (status && VALID_STATUSES.has(status)) query = query.eq("status", status);

    if (search) {
      const orParts: string[] = [
        `recipient_username.ilike.%${search}%`,
        `recipient_email.ilike.%${search}%`,
        `recipient_address.ilike.%${search}%`,
        `created_by.ilike.%${search}%`,
        `recipient_user_id.ilike.%${search}%`,
        `sender_tx_hash.ilike.%${search}%`,
        `sweep_tx_hash.ilike.%${search}%`,
        `description.ilike.%${search}%`,
      ];
      // UUID columns can't use ilike — only add exact match when search looks like a UUID
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(search)) orParts.push(`id.eq.${search}`);
      for (const uid of extraSenderIds) {
        orParts.push(`created_by.eq.${uid}`, `recipient_user_id.eq.${uid}`);
      }
      query = query.or(orParts.join(","));
    }

    return query;
  };

  let { data: payments, error, count } = await buildQuery(paymentSelect);
  for (let attempt = 0; attempt < optionalColumns.length && error?.code === "42703"; attempt++) {
    const missing = optionalColumns.find((col) => (error?.message || "").includes(col));
    if (!missing) break;
    paymentSelect = paymentSelect.replace(`, ${missing}`, "");
    ({ data: payments, error, count } = await buildQuery(paymentSelect));
  }

  if (error) {
    console.error("[admin/payments] query error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!payments || payments.length === 0) {
    return NextResponse.json({ payments: [], total: count ?? 0, page, limit });
  }

  // Batch-fetch user profiles for senders + recipients
  const privyIds = [
    ...new Set([
      ...payments.map((p: any) => p.created_by),
      ...payments.map((p: any) => p.recipient_user_id),
    ].filter(Boolean)),
  ];

  const userMap: Record<string, { privy_user_id: string; username: string | null; email: string | null }> = {};
  if (privyIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("privy_user_id, username, email")
      .in("privy_user_id", privyIds);
    for (const u of users ?? []) {
      userMap[(u as any).privy_user_id] = u as any;
    }
  }

  const enriched = payments.map((p: any) => ({
    ...p,
    sender_user: p.created_by ? (userMap[p.created_by] ?? null) : null,
    recipient_user: p.recipient_user_id ? (userMap[p.recipient_user_id] ?? null) : null,
  }));

  return NextResponse.json({ payments: enriched, total: count ?? 0, page, limit });
}
