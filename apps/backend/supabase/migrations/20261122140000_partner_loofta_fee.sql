-- Loofta's own fee on a partner withdrawal ($0.10 plus 0.5%), stamped with the partner fee before the payout is swept.
-- Run this BEFORE deploying the backend change: the withdraw flow writes this column when it stamps a payout.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_loofta_fee_usdc NUMERIC(18,6);
