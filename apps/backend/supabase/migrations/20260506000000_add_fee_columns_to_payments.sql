-- Add fee tracking column directly to the payments table so the payment summary
-- can show the exact platform fee the sender paid on reload.
--
-- fee_paid_usdc: Loofta platform fee charged to sender (BPS + SOL recovery), in USDC.
--               The total sender paid = payments.amount + fee_paid_usdc.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS fee_paid_usdc NUMERIC(20, 6) DEFAULT NULL;

COMMENT ON COLUMN public.payments.fee_paid_usdc IS 'Platform fee charged to sender (Loofta BPS + SOL gas recovery), in USDC.';
