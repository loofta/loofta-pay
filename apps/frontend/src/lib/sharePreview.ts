import { getSupabaseAdmin } from "@/lib/supabaseServer";

const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";

export interface SharePreview {
  /** The id to link into `/c/:id` with — the short code when this payment has one, else its UUID. */
  short_id: string;
  sender_username: string | null;
  recipient_username: string | null;
  amount_usd: number;
  status: string;
  is_devnet: boolean;
  is_private: boolean;
}

/**
 * Resolves the public-safe preview of a payment by its share code (or raw UUID, for payments
 * that predate short links). Shared by the `/api/share/:short_id` data route and the
 * `/api/share/:short_id/og` image route so username-resolution logic doesn't drift between them.
 * Never returns email or wallet address.
 */
export async function getSharePreview(shortIdOrUuid: string): Promise<SharePreview | null> {
  const supabase = getSupabaseAdmin();
  const SELECT = "id, short_id, amount, status, is_devnet, is_private, created_by, recipient_address, recipient_username";

  let { data: payment } = await supabase.from("payments").select(SELECT).eq("short_id", shortIdOrUuid).maybeSingle();
  if (!payment) {
    ({ data: payment } = await supabase.from("payments").select(SELECT).eq("id", shortIdOrUuid).maybeSingle());
  }
  if (!payment) return null;

  const status = String(payment.status || "").toUpperCase();
  if (status === "DELETED" || status === "CANCELLED") return null;

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

  return {
    short_id: payment.short_id || payment.id,
    sender_username,
    recipient_username,
    amount_usd: parseFloat(String(payment.amount || "0")),
    status,
    is_devnet: !!payment.is_devnet,
    is_private: !!payment.is_private,
  };
}
