-- Short shareable link for giveaways, same convention as payments.short_id (8-char base62,
-- resolved alongside the real UUID at read time so a shared /rewards/giveaways/{shortId} link
-- works exactly like the full-uuid one).
ALTER TABLE public.giveaways
  ADD COLUMN IF NOT EXISTS short_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS giveaways_short_id_uidx
  ON public.giveaways (short_id) WHERE short_id IS NOT NULL;

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
