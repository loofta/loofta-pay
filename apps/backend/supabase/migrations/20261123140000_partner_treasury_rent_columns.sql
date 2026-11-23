-- Rent recovery for finished company-wallet proposals.
-- The 10-minute job that closes executed proposals (and returns their rent to the fee payer) reads these two columns.
-- They were in the original table definition, but a table created before they were added never got them, so the job has
-- been failing with "column does not exist" and the rent of every proposal has stayed locked. Safe to run twice.
ALTER TABLE public.partner_treasury_proposals
  ADD COLUMN IF NOT EXISTS rent_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rent_close_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS partner_treasury_proposals_rent_idx
  ON public.partner_treasury_proposals (created_at)
  WHERE rent_closed_at IS NULL;
