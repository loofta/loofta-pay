-- SOL sent to a one-time backend-held address is swapped to USDC with Jupiter and forwarded to the person's own
-- wallet (no delegated-key signing needed). route says which rail an order uses; the burner key is encrypted.
ALTER TABLE public.agent_funding_orders ADD COLUMN IF NOT EXISTS route TEXT NOT NULL DEFAULT 'near';
ALTER TABLE public.agent_funding_orders ADD COLUMN IF NOT EXISTS burner_key_enc TEXT;
