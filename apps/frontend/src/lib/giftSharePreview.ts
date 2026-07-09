import { getSupabaseAdmin } from "@/lib/supabaseServer";

export interface GiftSharePreview {
  numTickets: number;
  note: string | null;
  status: string;
}

/**
 * Public-safe preview of a Megapot ticket gift by its claim token. Shared by the public share
 * page (`/gift/:token`, generateMetadata) and its OG image route so they can't drift. Never
 * returns recipient_identifier or sender identity — this is rendered for anonymous viewers.
 */
export async function getGiftSharePreview(token: string): Promise<GiftSharePreview | null> {
  const supabase = getSupabaseAdmin();
  const { data: gift } = await supabase
    .from("lottery_gifts")
    .select("num_tickets, note, status")
    .eq("claim_token", token)
    .maybeSingle();
  if (!gift) return null;
  return { numTickets: gift.num_tickets, note: gift.note, status: gift.status };
}
