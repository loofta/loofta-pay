-- Mirrors claim_payment_id: for a megapot_ticket giveaway, a winner's prize lands as a
-- lottery_gifts row (gifted Megapot tickets, delivered pre-claimed) instead of a payments row.
ALTER TABLE public.giveaway_entries
  ADD COLUMN IF NOT EXISTS claim_gift_id uuid REFERENCES public.lottery_gifts(id);

CREATE INDEX IF NOT EXISTS giveaway_entries_claim_gift_id_idx
  ON public.giveaway_entries (claim_gift_id);
