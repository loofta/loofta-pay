-- Stake to win (Ample): one row per confirmed on-chain stake, withdrawal or prize claim.
-- Ample folds claimed prizes into the vault balance and does not keep principal separate, so this
-- ledger is what lets us show total won and a personal APY (winnings over time-weighted stake).
CREATE TABLE IF NOT EXISTS public.stake_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id  TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  vault_id       TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw', 'claim')),
  -- Token base units (USDC has 6 decimals). NUMERIC so nothing is lost to float rounding.
  amount_base    NUMERIC(40, 0) NOT NULL CHECK (amount_base >= 0),
  decimals       SMALLINT NOT NULL DEFAULT 6,
  -- Confirmed Solana signature. Unique so a retried or double-reported event is stored once.
  tx_signature   TEXT NOT NULL,
  -- Ample payout id, only set for kind = 'claim'.
  payout_id      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stake_events_tx_signature_key UNIQUE (tx_signature),
  CONSTRAINT stake_events_claim_has_payout CHECK (kind <> 'claim' OR payout_id IS NOT NULL)
);

-- A claim can only be recorded once per payout, even if it lands under two signatures.
CREATE UNIQUE INDEX IF NOT EXISTS stake_events_payout_id_key
  ON public.stake_events (payout_id) WHERE payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS stake_events_user_created_idx
  ON public.stake_events (privy_user_id, created_at);

-- Security: all access goes through service-role API routes
ALTER TABLE public.stake_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stake_events FROM anon, authenticated;
