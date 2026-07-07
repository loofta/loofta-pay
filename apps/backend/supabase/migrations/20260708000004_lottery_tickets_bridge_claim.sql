-- Prevents two concurrent cron ticks (or two backend replicas) from both bridging the same
-- burner wallet. Incident: two Li.Fi bridge txs were submitted for one ticket in the same
-- Solana slot; only the failing one's hash survived the race to update lifi_buy_tx_hash,
-- so the ticket was wrongly marked failed even though the real bridge tx had succeeded.
ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS bridge_claimed_at timestamptz;
