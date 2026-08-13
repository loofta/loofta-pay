-- Peer Cash SDK migration (@zkp2p/cash): persist the real fill-time ETA shown to users, and the
-- access-policy tx hash the new SDK submits for Venmo/Cash App/PayPal cash-outs, so both are
-- visible in the admin dashboard alongside the existing deposit/status columns.
ALTER TABLE offramp_requests
  ADD COLUMN IF NOT EXISTS eta_seconds           INTEGER,
  ADD COLUMN IF NOT EXISTS eta_label             TEXT,
  ADD COLUMN IF NOT EXISTS access_policy_tx_hash  TEXT;
