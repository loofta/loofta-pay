-- Real, deliberate flat platform fee for posting a giveaway (distinct from the old per-winner
-- MagicBlock buffer removed in the previous migration cycle, which was accidental overcharge with
-- no real cost behind it). Stored per-row (not just a live constant) so a giveaway's fee is a
-- fixed historical fact even if the platform-wide fee amount changes later — the same snapshot
-- convention already used for funding_required_usd. Lands in the Solana fee-payer's own wallet at
-- giveaway completion (see GiveawayBurnerSweepService.refundRemainingToCreator).
ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS platform_fee_usd NUMERIC(20, 6) NOT NULL DEFAULT 0;

DROP VIEW IF EXISTS public.giveaways_safe;
CREATE VIEW public.giveaways_safe AS
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  title,
  description,
  logo_url,
  project_name,
  short_id,
  winner_count,
  selection_mode,
  prize_amount_usd,
  entries_close_at,
  eligibility,
  burner_address,
  mint,
  is_devnet,
  funding_required_usd,
  funding_confirmed_usd,
  platform_fee_usd,
  burner_reclaimed_at,
  vrf_request_slot,
  vrf_randomness,
  vrf_requested_at,
  vrf_fulfilled_at,
  entry_snapshot_hash,
  admin_reviewed_by,
  admin_reviewed_at,
  rejection_reason,
  cancel_reason,
  is_official,
  status
FROM public.giveaways;
ALTER VIEW public.giveaways_safe SET (security_invoker = true);
