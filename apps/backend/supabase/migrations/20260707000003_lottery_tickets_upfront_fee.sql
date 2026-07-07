-- Purchase flow redesign: the fee is now collected UPFRONT via its own plain (non-private)
-- transaction, before the MagicBlock transfer, since we can't append a fee-collection
-- instruction to MagicBlock's own pre-built transaction. The MagicBlock exactOut amount is
-- now simply cost_usdc (already a whole dollar amount — no rounding needed). The burner is
-- topped up from the fee wallet at bridge time to cover Li.Fi's cut instead of the old
-- sweep-from-burner approach.
--
-- user_solana_address:   persisted so a refund (if anything downstream fails) has a
--                        destination without re-deriving it.
-- fee_amount_usdc:       amount actually collected upfront for this purchase attempt.
-- fee_tx_hash:           signature of the user's fee-payment transaction.
-- fee_refunded_at:       set when the fee has been refunded back to the user (failure path).
-- fee_refund_tx_hash:    signature of the refund transaction.
ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS user_solana_address text,
  ADD COLUMN IF NOT EXISTS fee_amount_usdc numeric(20,6),
  ADD COLUMN IF NOT EXISTS fee_tx_hash text,
  ADD COLUMN IF NOT EXISTS fee_refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS fee_refund_tx_hash text;

CREATE INDEX IF NOT EXISTS idx_lottery_tickets_fee_pending
  ON lottery_tickets (created_at)
  WHERE fee_tx_hash IS NOT NULL AND sender_tx_hash IS NULL AND fee_refunded_at IS NULL;
