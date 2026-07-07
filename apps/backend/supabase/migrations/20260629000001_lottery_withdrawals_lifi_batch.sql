-- Add Li.Fi bridge columns and batch withdrawal support to lottery_withdrawals
ALTER TABLE lottery_withdrawals
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS lifi_tx_hash text,
  ADD COLUMN IF NOT EXISTS lifi_step_tool text;

CREATE INDEX IF NOT EXISTS idx_lottery_withdrawals_batch_id
  ON lottery_withdrawals(batch_id)
  WHERE batch_id IS NOT NULL;
