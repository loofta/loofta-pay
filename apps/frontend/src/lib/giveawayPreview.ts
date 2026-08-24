import { getSupabaseAdmin } from "@/lib/supabaseServer";

export interface GiveawayPreview {
  id: string;
  title: string;
  prize_amount_usd: number;
  reward_type: "usdc" | "megapot_ticket";
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
  const cols = "id, title, prize_amount_usd, reward_type, winner_count, entries_close_at, status, is_devnet";
  // Accepts either the UUID or the 8-char short_id — same dual-lookup convention as the backend's
  // GiveawaysPublicController.fetchGiveawayByIdOrShortId, so a shared short link's OG image/meta
  // tags resolve exactly like the full-uuid one.
  const { data: byId } = await supabase.from("giveaways_safe").select(cols).eq("id", id).maybeSingle();
  const data = byId ?? (await supabase.from("giveaways_safe").select(cols).eq("short_id", id).maybeSingle()).data;
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    prize_amount_usd: parseFloat(String(data.prize_amount_usd || "0")),
    reward_type: (data.reward_type as "usdc" | "megapot_ticket") ?? "usdc",
    winner_count: data.winner_count,
    entries_close_at: data.entries_close_at,
    status: String(data.status || "").toUpperCase(),
    is_devnet: !!data.is_devnet,
  };
}
