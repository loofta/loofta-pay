import { getSupabaseAdmin } from "@/lib/supabaseServer";

const PENDING_USERNAME_PREFIX = "PENDING_USERNAME:";
const PENDING_EMAIL_PREFIX = "PENDING_EMAIL:";
/** Must match ClaimsService.PENDING_SOCIAL_PREFIX (backend claims.service.ts). Format: PENDING_SOCIAL:<platform>:<handle> */
const PENDING_SOCIAL_PREFIX = "PENDING_SOCIAL:";

export interface SharePreview {
  /** The id to link into `/c/:id` with — the short code when this payment has one, else its UUID. */
  short_id: string;
  sender_username: string | null;
  recipient_username: string | null;
  /** Set instead of recipient_username when the payment is addressed to a Twitter/Discord/GitHub/Telegram
   *  handle, or to the literal string "email" (no handle) when it's addressed to an email — never the
   *  actual address, so the card can still show which platform without exposing it. */
  recipient_social_platform: string | null;
  recipient_social_handle: string | null;
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
  const SELECT = "id, short_id, amount, status, is_devnet, is_private, direction, created_by, sender_user_id, recipient_address, recipient_username, recipient_user_id";

  let { data: payment } = await supabase.from("payments").select(SELECT).eq("short_id", shortIdOrUuid).maybeSingle();
  if (!payment) {
    ({ data: payment } = await supabase.from("payments").select(SELECT).eq("id", shortIdOrUuid).maybeSingle());
  }
  if (!payment) return null;

  const status = String(payment.status || "").toUpperCase();
  if (status === "DELETED" || status === "CANCELLED") return null;

  // Payment request links (direction = "from_recipient", created via the "request money" flow)
  // flip who `created_by` and `recipient_user_id` represent: the creator is the true recipient
  // (the person asking to be paid), and `recipient_user_id`/`recipient_address` redundantly store
  // that same creator identity rather than the payer's. The real sender is unknown until they pay
  // and `sender_user_id` gets set. Same flip applied in `/api/claims/[id]/route.ts` (creator_username)
  // and `/api/payments/history/route.ts`.
  const isFromRecipient = String(payment.direction ?? "") === "from_recipient";
  const senderId = String(isFromRecipient ? payment.sender_user_id ?? "" : payment.created_by ?? "");
  const trueRecipientId = String(isFromRecipient ? payment.created_by ?? "" : payment.recipient_user_id ?? "");

  // recipient_username is only populated when the payment was created by resolving a
  // username/email — a payment sent by resolving a wallet address directly can still have a
  // known registered recipient_user_id with no recipient_username on the row. Same fallback as
  // `/api/claims/[id]/route.ts` so the share card doesn't silently drop a known recipient's name.
  const [{ data: senderAppUser }, { data: recipientAppUser }] = await Promise.all([
    senderId.includes("did:privy:")
      ? supabase.from("app_users").select("username").eq("privy_user_id", senderId).maybeSingle()
      : Promise.resolve({ data: null }),
    !payment.recipient_username && trueRecipientId.includes("did:privy:")
      ? supabase.from("app_users").select("username").eq("privy_user_id", trueRecipientId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const sender_username: string | null = (senderAppUser as { username?: string } | null)?.username ?? null;
  const resolvedRecipientUsername: string | null = (recipientAppUser as { username?: string } | null)?.username ?? null;

  const recipientAddress = String(payment.recipient_address ?? "").trim();
  const recipient_username: string | null =
    payment.recipient_username ||
    resolvedRecipientUsername ||
    (recipientAddress.startsWith(PENDING_USERNAME_PREFIX)
      ? recipientAddress.slice(PENDING_USERNAME_PREFIX.length).trim()
      : null);

  let recipient_social_platform: string | null = null;
  let recipient_social_handle: string | null = null;
  if (!recipient_username && recipientAddress.startsWith(PENDING_SOCIAL_PREFIX)) {
    const rest = recipientAddress.slice(PENDING_SOCIAL_PREFIX.length);
    const sep = rest.indexOf(":");
    recipient_social_platform = sep >= 0 ? rest.slice(0, sep).trim() : null;
    recipient_social_handle = (sep >= 0 ? rest.slice(sep + 1) : rest).trim();
  } else if (!recipient_username && recipientAddress.startsWith(PENDING_EMAIL_PREFIX)) {
    // No handle exposed here — this is only a platform marker so the card can show a mail icon.
    recipient_social_platform = "email";
  }

  return {
    short_id: payment.short_id || payment.id,
    sender_username,
    recipient_username,
    recipient_social_platform,
    recipient_social_handle,
    amount_usd: parseFloat(String(payment.amount || "0")),
    status,
    is_devnet: !!payment.is_devnet,
    is_private: !!payment.is_private,
  };
}
