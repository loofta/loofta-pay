-- Lets an admin create a giveaway "as Loofta" — shows the Loofta brand instead of the creator's
-- own identity, sorts to the top of public listings, and (enforced server-side in
-- GiveawaysService.create(), never trusted from the client) auto-approves so the sole admin can
-- test the full funding -> draw -> claim-link pipeline end to end with a small prize (e.g. $10)
-- without a redundant self-approval step.
ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;

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
