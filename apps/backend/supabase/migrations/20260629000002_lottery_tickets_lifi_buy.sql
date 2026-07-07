-- Li.Fi buy flow tracking columns on lottery_tickets
-- lifi_buy_tx_hash: Solana tx signature from Li.Fi SOL→Base bridge
-- lifi_buy_tool: Li.Fi bridge tool name (e.g. "mayan", "debridge") for status polling
ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS lifi_buy_tx_hash text,
  ADD COLUMN IF NOT EXISTS lifi_buy_tool text;

CREATE INDEX IF NOT EXISTS idx_lottery_tickets_lifi_buy_tx ON lottery_tickets(lifi_buy_tx_hash) WHERE lifi_buy_tx_hash IS NOT NULL;
