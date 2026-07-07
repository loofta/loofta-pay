-- Tracks whether Loofta's fee sweep has already run for a purchase, so the bridging
-- cron can tell "still waiting for MagicBlock's split-transfer parts to fully land"
-- (gate on the full round-dollar amount) apart from "fee already swept, just retrying
-- a later step that failed" (gate on bridgeUnits only). Without this distinction, a
-- retry after a partial run would either double-sweep or wait forever on funds that
-- already moved out.
ALTER TABLE lottery_tickets
  ADD COLUMN IF NOT EXISTS fee_swept_at timestamptz;
