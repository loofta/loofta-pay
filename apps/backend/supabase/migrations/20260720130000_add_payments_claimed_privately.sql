-- payments.is_private records how a payment was FUNDED (sender -> burner leg).
-- claimed_privately records how it was CLAIMED (burner -> recipient leg) — these are
-- independent facts (e.g. a publicly-sent payment can still be claimed privately), needed
-- so history views can show a privacy icon for each side independently.
ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS claimed_privately boolean NOT NULL DEFAULT false;
