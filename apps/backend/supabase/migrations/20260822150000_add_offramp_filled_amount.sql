-- Peer Cash orders can partially fill (multiple buyer intents against one deposit). Persist the
-- live filled amount + order state from CashOrder so users/admins can see how much has actually
-- arrived, instead of only a binary DEPOSITED/COMPLETE status against the requested total.
ALTER TABLE offramp_requests
  ADD COLUMN IF NOT EXISTS filled_amount_usdc  NUMERIC,
  ADD COLUMN IF NOT EXISTS fill_state          TEXT;
