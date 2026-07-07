-- Persist the purchase-time computed transfer amounts on lottery_tickets so the
-- bridging cron reads back what was ACTUALLY sent via MagicBlock instead of
-- re-deriving it from a fresh Li.Fi quote (which can drift between purchase time
-- and bridge time and get a ticket permanently stuck waiting on a balance that
-- will never arrive).
--
-- bridge_units_at_purchase:      base units (6dp) forwarded into Li.Fi so the
--                                 companion nets cost_usdc on Base.
-- magicblock_amount_units:       base units (6dp) actually sent to the burner via
--                                 the MagicBlock exactOut transfer (rounded whole
--                                 dollar figure).
ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS bridge_units_at_purchase bigint,
  ADD COLUMN IF NOT EXISTS magicblock_amount_units bigint;
