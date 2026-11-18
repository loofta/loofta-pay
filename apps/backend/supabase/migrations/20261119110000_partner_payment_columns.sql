-- Two payments columns the partner withdraw flow needs. They were added to 20261117110000 after
-- that file had already been applied, so databases that ran the earlier version are missing them.
-- Safe to run on any database: both statements are no-ops when the column already exists.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_fee_wallet TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_withdrawn_at TIMESTAMPTZ;
