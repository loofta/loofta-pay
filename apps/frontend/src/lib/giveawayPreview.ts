import { getSupabaseAdmin } from "@/lib/supabaseServer";

export interface GiveawayPreview {
  id: string;
  title: string;
  prize_amount_usd: number;
  winner_count: number;
  entries_close_at: string;
  status: string;
  is_devnet: boolean;
}

/**
 * Resolves the public-safe preview of a giveaway by id. Shared by the giveaway detail page's
 * `generateMetadata` and the `/api/giveaways/:id/og` image route, same split as
 * `sharePreview.ts`/`/api/share/:short_id/og` for payments — reads straight from
 * `giveaways_safe` (never `giveaways` directly), which already strips `burner_encrypted_secret`
 * at the view level.
 */
export async function getGiveawayPreview(id: string): Promise<GiveawayPreview | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("giveaways_safe")
    .select("id, title, prize_amount_usd, winner_count, entries_close_at, status, is_devnet")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    prize_amount_usd: parseFloat(String(data.prize_amount_usd || "0")),
    winner_count: data.winner_count,
    entries_close_at: data.entries_close_at,
    status: String(data.status || "").toUpperCase(),
    is_devnet: !!data.is_devnet,
  };
}
