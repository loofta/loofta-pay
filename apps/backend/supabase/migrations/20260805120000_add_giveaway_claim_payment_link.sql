-- Winner payouts move from a direct wallet sweep to a claim-link model: each winner gets their
-- own payments row (same mechanism as multi-send), funded from the giveaway's own burner, so they
-- claim publicly or privately through the existing /c/[id] flow instead of picking a destination
-- wallet upfront. This column lets the giveaways module find/display the claim link per winner.
ALTER TABLE public.giveaway_entries
  ADD COLUMN IF NOT EXISTS claim_payment_id UUID REFERENCES public.payments(id);

CREATE INDEX IF NOT EXISTS giveaway_entries_claim_payment_id_idx
  ON public.giveaway_entries (claim_payment_id);

-- Recreate giveaways_safe-adjacent entries view (if one exists) is not needed here — entries are
-- read via service-role only (RLS deny-all, same as the rest of this table), no *_safe view exists
-- for giveaway_entries.
