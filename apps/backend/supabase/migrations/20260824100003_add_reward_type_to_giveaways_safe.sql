-- The public giveaways_safe view (read by giveaways-public.controller.ts, never the raw table)
-- has an explicit column list that predates reward_type — recreate it to include the column, or
-- every public/entrant-facing page silently sees reward_type as undefined and falls back to USDC
-- display for a megapot_ticket giveaway.
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
  reward_type,
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
