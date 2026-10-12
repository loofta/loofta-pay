-- How a recipient chose to take a claim, and where that cash-out stands.
-- Wallet claims keep the usual success screen. Every other method (Venmo, Cash App,
-- Revolut, Zelle, Coinbase, PAJ Cash, an external wallet, NEAR Intents) stores a
-- receipt here so the claim page can keep showing status and ETA after a reload.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS claim_payout_method text,
  ADD COLUMN IF NOT EXISTS claim_payout_status text,
  ADD COLUMN IF NOT EXISTS claim_payout_eta_label text,
  ADD COLUMN IF NOT EXISTS claim_payout_detail text,
  ADD COLUMN IF NOT EXISTS claim_payout_updated_at timestamptz;
