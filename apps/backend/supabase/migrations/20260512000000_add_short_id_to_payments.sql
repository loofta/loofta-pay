-- Add short_id to payments for compact share URLs.
-- Backfill is in the next migration (20260512000001_backfill_payment_short_ids.sql).
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS short_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payments_short_id_idx
  ON public.payments (short_id)
  WHERE short_id IS NOT NULL;


