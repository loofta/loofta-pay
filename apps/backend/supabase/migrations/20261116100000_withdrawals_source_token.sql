-- Cross-chain swaps can be paid in SOL, not just USDC. Keep what the user actually paid so the
-- history can show it next to the NEAR Intents deposit address (amount_usdc stays the USD value).
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS source_token  TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS source_amount NUMERIC(30, 9);
