-- Tracks which fiat currency the recipient actually receives (Revolut can be paid out in
-- EUR; Venmo/Cash App are USD-only). amount_usdc always stays USDC/USD (what the sender
-- actually pays on-chain) — this column only affects how amount_payout should be labeled.
ALTER TABLE beam_payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
