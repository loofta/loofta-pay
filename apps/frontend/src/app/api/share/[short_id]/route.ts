'use server'

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";

/**
 * Public, unauthenticated preview of a payment by its short link code — backs `/share/:short_id`.
 * Mirrors `/api/twitter-payments/[short_id]` (public preview, no auth) but reads the real
 * `payments` row and resolves Loofta usernames instead of Twitter handles. Never returns the
 * recipient's email or wallet address — only what's already shown on a public share card.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ short_id: string }> },
) {
  const { short_id } = await params;
  const supabase = getSupabaseAdmin();

  const SELECT = "id, short_id, amount, status, is_devnet, is_private, created_by, recipient_address, recipient_username";

  let { data: payment } = await supabase.from("payments").select(SELECT).eq("short_id", short_id).maybeSingle();
  // Older payments predate short links — fall back to treating the param as the raw UUID.
  if (!payment) {
    ({ data: payment } = await supabase.from("payments").select(SELECT).eq("id", short_id).maybeSingle());
  }

  if (!payment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const status = String(payment.status || "").toUpperCase();
  if (status === "DELETED" || status === "CANCELLED") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const createdBy = String(payment.created_by ?? "");
  const { data: appUser } = createdBy.includes("did:privy:")
    ? await supabase.from("app_users").select("username").eq("privy_user_id", createdBy).maybeSingle()
    : { data: null };
  const sender_username: string | null = (appUser as { username?: string } | null)?.username ?? null;

  const recipientAddress = String(payment.recipient_address ?? "").trim();
  const recipient_username: string | null =
    payment.recipient_username ||
    (recipientAddress.startsWith(PENDING_USERNAME_PREFIX)
      ? recipientAddress.slice(PENDING_USERNAME_PREFIX.length).trim()
      : null);

  return NextResponse.json({
    // The id to link into `/c/:id` with — the short code when this payment has one, else its UUID.
    short_id: payment.short_id || payment.id,
    sender_username,
    recipient_username,
    amount_usd: parseFloat(String(payment.amount || "0")),
    status,
    is_devnet: !!payment.is_devnet,
    is_private: !!payment.is_private,
  });
}
