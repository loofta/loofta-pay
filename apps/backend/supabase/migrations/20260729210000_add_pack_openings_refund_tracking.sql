-- Tracks manual refunds issued for a Mystery Pack whose treasury-funded ticket purchase
-- permanently failed (retries exhausted) — see PackService.refundFailedPackOpening.
-- status='refunded' is a new value alongside the existing 'opened' | 'fulfilled' | 'failed'
-- (status is a free-text column, no CHECK constraint to update).

ALTER TABLE pack_openings ADD COLUMN IF NOT EXISTS refund_tx_hash text;
ALTER TABLE pack_openings ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
