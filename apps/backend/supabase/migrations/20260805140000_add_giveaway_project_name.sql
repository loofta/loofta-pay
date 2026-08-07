-- Lets a project attach their own name + logo to a giveaway they create, shown as a small
-- icon+name badge (same visual treatment as the "official Loofta" badge) instead of the plain
-- created_by Privy id. logo_url already existed but was never wired to any UI; project_name is new.
ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS project_name TEXT;

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
