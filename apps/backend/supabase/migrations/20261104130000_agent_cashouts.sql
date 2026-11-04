-- An agent paying someone's Revolut / Venmo / Cash App / X Money. Each cash-out gets its own temporary Base wallet
-- held by the backend (key encrypted with the same master key as burner wallets). See the later migration
-- 20261104170000 for the Solana burner columns.
CREATE TABLE IF NOT EXISTS public.agent_cashouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id        TEXT NOT NULL,
  session_id     UUID NOT NULL,
  action_id      UUID NOT NULL,
  offramp_id     UUID,
  platform       TEXT NOT NULL,
  handle         TEXT NOT NULL,
  payout_usd     NUMERIC(12,2) NOT NULL,
  gross_usdc     NUMERIC(20,6) NOT NULL,
  base_address   TEXT NOT NULL,
  base_key_enc   TEXT NOT NULL,
  step           TEXT NOT NULL DEFAULT 'bridging',
  attempts       INT NOT NULL DEFAULT 0,
  deposit_id     TEXT,
  error          TEXT,
  UNIQUE (action_id)
);
CREATE INDEX IF NOT EXISTS agent_cashouts_open_idx ON public.agent_cashouts (step) WHERE step NOT IN ('done','refunded','failed');
ALTER TABLE public.agent_cashouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_agent_cashouts ON public.agent_cashouts;
CREATE POLICY deny_all_agent_cashouts ON public.agent_cashouts FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.agent_cashouts FROM anon, authenticated;
