import { getSupabaseAdmin } from "@/lib/supabaseServer";

// short_id is alphanumeric, the legacy claim_token is a UUID (hex + hyphens) — both fit this
// charset. idOrToken is spliced straight into a PostgREST `.or()` filter string below; an
// unvalidated value containing a comma or `.`/`(` could inject additional filter clauses instead
// of just matching this one gift.
const GIFT_TOKEN_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export interface GiftSharePreview {
  numTickets: number;
  note: string | null;
  status: string;
  /** Loofta username of whoever sent the gift, or null if unresolved. */
  senderUsername: string | null;
  /** Recipient's X/Loofta handle — only populated when the gift targeted a handle, never an email. */
  recipientHandle: string | null;
}

/**
 * Public-safe preview of a Megapot ticket gift by its share id — accepts either the short share
 * id or (for links sent before short ids existed) the long claim_token. Shared by the public
 * share page (`/gift/:id`, generateMetadata) and its OG image route so they can't drift. Never
 * returns a raw email recipient_identifier — mirrors sharePreview.ts's payment convention where
 * only public-safe usernames/handles are exposed, never email or wallet address.
 */
export async function getGiftSharePreview(idOrToken: string): Promise<GiftSharePreview | null> {
  if (!GIFT_TOKEN_PATTERN.test(idOrToken)) return null;
  const supabase = getSupabaseAdmin();
  const { data: gift } = await supabase
    .from("lottery_gifts")
    .select("num_tickets, note, status, recipient_type, recipient_identifier, created_by_user_id")
    .or(`short_id.eq.${idOrToken},claim_token.eq.${idOrToken}`)
    .maybeSingle();
  if (!gift) return null;

  const { data: senderAppUser } = gift.created_by_user_id
    ? await supabase.from("app_users").select("username").eq("privy_user_id", gift.created_by_user_id).maybeSingle()
    : { data: null };

  return {
    numTickets: gift.num_tickets,
    note: gift.note,
    status: gift.status,
    senderUsername: (senderAppUser as { username?: string } | null)?.username ?? null,
    recipientHandle: gift.recipient_type === "handle" ? gift.recipient_identifier : null,
  };
}
