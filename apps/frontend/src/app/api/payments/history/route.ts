import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const CLAIM_SELECT =
  "id, amount, to_symbol, to_chain, status, created_at, paid_at, recipient_address, recipient_username, creator_email, created_by, paid_with_token, paid_with_chain, is_private, description";

const OPEN_PAYMENT_EXPIRY_DAYS = 7;

export type PaymentHistoryClaim = {
  id: string;
  amount: string;
  to_symbol: string;
  to_chain: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  recipient_address: string;
  recipient_username?: string | null;
  creator_email: string | null;
  creator_username?: string | null;
  created_by: string | null;
  paid_with_token: string | null;
  paid_with_chain: string | null;
  is_private: boolean | null;
  description: string | null;
};

const TERMINAL_STATUSES = ["SUCCESS", "CANCELLED", "REFUNDED", "EXPIRED", "DELETED"];

function isExpiredOpenPayment(claim: PaymentHistoryClaim): boolean {
  const status = String(claim.status || "").toUpperCase();
  if (TERMINAL_STATUSES.includes(status)) return false;
  const created = new Date(claim.created_at).getTime();
  const cutoff = Date.now() - OPEN_PAYMENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return created < cutoff;
}

export async function GET(request: Request) {
  try {
    const userId = request.headers.get("x-privy-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let walletAddresses: string[] = (searchParams.get("walletAddresses") || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (walletAddresses.length === 0) {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
      try {
        const res = await fetch(`${backendUrl}/users/me/wallet/balance`, {
          headers: { "x-privy-user-id": userId },
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

    // Sent: claims I created
    const { data: sentRows, error: sentError } = await supabase
      .from("claims")
      .select(CLAIM_SELECT)
      .eq("created_by", userId)
      .order("created_at", { ascending: false });

    if (sentError) {
      console.error("[payments/history] Sent query error:", sentError);
      return NextResponse.json(
        { error: sentError.message },
        { status: 500 }
      );
    }

    let receivedRows: PaymentHistoryClaim[] = [];
    if (walletAddresses.length > 0) {
      const { data: received, error: recError } = await supabase
        .from("claims")
        .select(CLAIM_SELECT)
        .in("recipient_address", walletAddresses)
        .order("created_at", { ascending: false });

      if (recError) {
        console.error("[payments/history] Received query error:", recError);
      } else {
        receivedRows = (received || []) as PaymentHistoryClaim[];
      }
    }

    const sentRaw = (sentRows || []) as PaymentHistoryClaim[];
    const receivedRaw = receivedRows;
    const allClaims = [...sentRaw, ...receivedRaw];
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
            .map((u) => [u.privy_user_id!, u.username!])
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
    const received = receivedRaw
      .map(enrich)
      .filter((c) => String(c.status || "").toUpperCase() === "SUCCESS");

    const res = NextResponse.json({ sent, received });
    res.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
    return res;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to fetch payment history";
    console.error("[payments/history]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
