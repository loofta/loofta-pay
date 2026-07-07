-- Tracks auto-refunds issued when a Li.Fi bridge stalls with no solver activity well past its
-- quoted execution time (see the 83cb2a7b incident: Eco Protocol left a $1 order funded
-- on-chain but never filled, with a quoted 7s execution time vs 20+ minutes actual). Loofta
-- fronts the user's ticket cost back to their own balance and chases bridge recovery separately.
ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS stall_refunded_at timestamptz;
ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS stall_refund_tx_hash text;
