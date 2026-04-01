import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isNonMainnetCluster } from "@/lib/solanaCluster";

// Only these fields are returned — recipient_address is excluded to protect privacy
const CLAIM_SELECT =
  "id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_username, creator_email, created_by, paid_with_token, paid_with_chain, is_private, description, is_devnet";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const OPEN_PAYMENT_EXPIRY_DAYS = 7;

export type PaymentHistoryClaim = {
  id: string;
  amount: string;
  to_symbol: string;
  to_chain: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  recipient_username?: string | null;
  creator_email: string | null;
  creator_username?: string | null;
  created_by: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  description: string | null;
  is_devnet?: boolean;
};

const TERMINAL_STATUSES = ["SUCCESS", "PRIVATE_TRANSFER_PENDING", "CANCELLED", "REFUNDED", "EXPIRED", "DELETED"];
const RECEIVED_VISIBLE_STATUSES = ["SUCCESS", "PRIVATE_TRANSFER_PENDING"];

function isExpiredOpenPayment(claim: PaymentHistoryClaim): boolean {
  const status = String(claim.status || "").toUpperCase();
  if (TERMINAL_STATUSES.includes(status)) return false;
  const cutoff = Date.now() - OPEN_PAYMENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return new Date(claim.created_at).getTime() < cutoff;
}

/**
 * Verify the caller's identity by calling the backend's /users/me endpoint.
 * This is the secure path — the backend verifies the JWT and returns the real userId.
 * Falls back to x-privy-user-id for local dev only (when backend not configured for JWT).
 */
async function getVerifiedUserId(request: Request): Promise<string | null> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

  // Preferred: Authorization: Bearer <privy_access_token>
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const res = await fetch(`${backendUrl}/users/me`, {
        headers: { authorization: authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) return data.userId;
      }
    } catch (e) {
      console.warn("[payments/history] Backend verify failed:", e);
    }
    // Token was sent but couldn't be verified — reject
    return null;
  }

  // Legacy: x-privy-user-id header — pass through to backend for user-existence check
  const legacyId = request.headers.get("x-privy-user-id");
  if (legacyId) {
    try {
      const res = await fetch(`${backendUrl}/users/me`, {
        headers: { "x-privy-user-id": legacyId },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) return data.userId;
      }
    } catch (e) {
      console.warn("[payments/history] Legacy header verify failed:", e);
    }
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const userId = await getVerifiedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Pagination
    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT), 10);
    const limit = Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT);
    const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10), 1);
    const offset = (page - 1) * limit;

    // Optional date filter: only show payments from the last N days (default: all)
    const daysBack = parseInt(searchParams.get("days") ?? "0", 10);
    const dateFilter = daysBack > 0
      ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Wallet address(es) for received query — passed by client or resolved from backend
    let walletAddresses: string[] = (searchParams.get("walletAddresses") || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (walletAddresses.length === 0) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      const authHeader = request.headers.get("authorization");
      const legacyId = request.headers.get("x-privy-user-id");
      try {
        const res = await fetch(`${backendUrl}/users/me/wallet/balance`, {
          headers: {
            ...(authHeader ? { authorization: authHeader } : {}),
            ...(legacyId ? { "x-privy-user-id": legacyId } : {}),
          },
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
    const devnetOnly = isNonMainnetCluster();

    // Sent: claims created by this user
    let sentQuery = supabase
      .from("claims")
      .select(CLAIM_SELECT)
      .eq("created_by", userId)
      .eq("is_devnet", devnetOnly)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (dateFilter) sentQuery = sentQuery.gte("created_at", dateFilter);

    const { data: sentRows, error: sentError } = await sentQuery;

    if (sentError) {
      console.error("[payments/history] Sent query error:", sentError);
      return NextResponse.json({ error: sentError.message }, { status: 500 });
    }

    // Received: claims where user is the recipient
    let receivedRows: PaymentHistoryClaim[] = [];
    if (walletAddresses.length > 0) {
      let recQuery = supabase
        .from("claims")
        .select(CLAIM_SELECT)
        .in("recipient_address", walletAddresses)
        .in("status", RECEIVED_VISIBLE_STATUSES)
        .eq("is_devnet", devnetOnly)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (dateFilter) recQuery = recQuery.gte("created_at", dateFilter);

      const { data: received, error: recError } = await recQuery;
      if (recError) {
        console.error("[payments/history] Received query error:", recError);
      } else {
        receivedRows = (received || []) as PaymentHistoryClaim[];
      }
    }

    const sentRaw = (sentRows || []) as PaymentHistoryClaim[];
    const allClaims = [...sentRaw, ...receivedRows];

    // Enrich with creator usernames in a single batch query
    const creatorIds = [...new Set(allClaims.map((c) => c.created_by).filter(Boolean))] as string[];
    let creatorUsernameMap: Record<string, string> = {};
    if (creatorIds.length > 0) {
      const { data: users } = await supabase
        .from("app_users")
        .select("privy_user_id, username")
        .in("privy_user_id", creatorIds);
      if (users) {
        creatorUsernameMap = Object.fromEntries(
          users
            .filter((u) => u.privy_user_id && u.username != null)
            .map((u) => [u.privy_user_id!, u.username!]),
        );
      }
    }

    const enrich = (c: PaymentHistoryClaim) => ({
      ...c,
      creator_username: (c.created_by && creatorUsernameMap[c.created_by]) || null,
    });

    const sent = sentRaw
      .map(enrich)
      .filter((c) => !isExpiredOpenPayment(c) && String(c.status || "").toUpperCase() !== "DELETED");

    const received = receivedRows
      .map(enrich)
      .filter((c) => RECEIVED_VISIBLE_STATUSES.includes(String(c.status || "").toUpperCase()));

    const res = NextResponse.json({ sent, received, page, limit });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to fetch payment history";
    console.error("[payments/history]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
