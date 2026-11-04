-- Cash-outs bridge from a Solana burner with Relay. Safe to run whatever earlier version of agent_cashouts is in
-- place: columns are added only if missing, and any NEAR-bridge columns from an earlier draft stop being required.
ALTER TABLE public.agent_cashouts ADD COLUMN IF NOT EXISTS sol_address TEXT;
ALTER TABLE public.agent_cashouts ADD COLUMN IF NOT EXISTS sol_key_enc TEXT;
ALTER TABLE public.agent_cashouts ADD COLUMN IF NOT EXISTS relay_request_id TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_cashouts' AND column_name = 'near_deposit_address') THEN
    ALTER TABLE public.agent_cashouts ALTER COLUMN near_deposit_address DROP NOT NULL;
  END IF;
END $$;
