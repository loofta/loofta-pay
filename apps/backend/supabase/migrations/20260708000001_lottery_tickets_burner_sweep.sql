-- Burner sweep: once the SOL→Base bridge has left the burner, the wallet is dead forever
-- but still strands real money — leftover gas SOL (~0.0009), USDC dust from quote rounding,
-- and ~0.002 SOL of reclaimable token-account rent. A cron sweeps all of it back to the fee
-- wallet and records it here so each burner is only swept once.
ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS burner_swept_at timestamptz,
  ADD COLUMN IF NOT EXISTS burner_sweep_tx_hash text;

CREATE INDEX IF NOT EXISTS idx_lottery_tickets_burner_sweep_pending
  ON lottery_tickets (created_at)
  WHERE burner_sol_address IS NOT NULL AND burner_swept_at IS NULL;
