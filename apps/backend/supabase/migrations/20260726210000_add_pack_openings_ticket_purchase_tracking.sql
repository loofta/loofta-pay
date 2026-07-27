-- Tracks the real Megapot ticket purchase triggered by a pack win (PackService.openPack ->
-- LotteryService.purchaseTicketsForUser). retry_count + purchase_failure_reason let the
-- treasury-funded purchase be retried on a cron if it fails without losing the user's win —
-- the pack_openings row itself already recorded the prize before this ever runs.

ALTER TABLE pack_openings ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE pack_openings ADD COLUMN IF NOT EXISTS purchase_failure_reason text;

CREATE INDEX IF NOT EXISTS pack_openings_failed_idx
  ON pack_openings (created_at)
  WHERE status = 'failed';
