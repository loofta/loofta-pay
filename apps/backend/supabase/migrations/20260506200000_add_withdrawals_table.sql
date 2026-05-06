-- Add withdrawals table for persistent cross-device withdrawal history and status tracking.
-- Access is service-role only (all client access goes through API routes).

CREATE TABLE IF NOT EXISTS public.withdrawals (
  id                   TEXT PRIMARY KEY,        -- Solana tx signature
  user_id              TEXT NOT NULL,           -- Privy user ID
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount_usdc          NUMERIC(20, 6) NOT NULL,
  tx_signature         TEXT NOT NULL,
  destination_address  TEXT NOT NULL,
  destination_chain    TEXT NOT NULL,
  destination_token    TEXT NOT NULL,
  is_near_intents      BOOLEAN NOT NULL DEFAULT FALSE,
  deposit_address      TEXT,                    -- Near Intents relay address for status polling
  estimated_out        TEXT,                    -- Estimated output amount (human-readable)
  quote_id             TEXT,
  near_intents_status  TEXT,                    -- Latest status from 1Click (PENDING/SUCCESS/REFUNDED/…)
  near_intents_complete BOOLEAN NOT NULL DEFAULT FALSE,
  is_devnet            BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- Deny all direct client access — API routes use service role key
DROP POLICY IF EXISTS deny_all_withdrawals ON public.withdrawals;
CREATE POLICY deny_all_withdrawals
  ON public.withdrawals
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created
  ON public.withdrawals (user_id, created_at DESC);
