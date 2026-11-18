-- =====================================================
-- Partner treasury: each partner org gets its own Squads multisig. The vault of that multisig is
-- the org's funding wallet; the members are the team's own Loofta wallets and the partner chooses
-- how many of them must approve. Loofta is never a member or the config authority: it only pays
-- fees and rent. Public keys only live here, no secret is stored.
-- =====================================================

ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS treasury_multisig   TEXT;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS treasury_vault      TEXT;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS treasury_threshold  INT CHECK (treasury_threshold IS NULL OR treasury_threshold >= 1);
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS treasury_created_at TIMESTAMPTZ;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS treasury_creation_tx TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS partners_treasury_multisig_idx ON public.partners (treasury_multisig) WHERE treasury_multisig IS NOT NULL;

-- The member's own wallet, set only once they are a member of the multisig on-chain. Derived
-- server-side from their Privy account, never taken from a request.
ALTER TABLE public.partner_members ADD COLUMN IF NOT EXISTS wallet_address TEXT;

-- Every proposal the portal builds for a team to approve. The chain is the source of truth for
-- status; this table remembers what each proposal is for (which payouts, which member change).
CREATE TABLE IF NOT EXISTS public.partner_treasury_proposals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  partner_id         UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('payout', 'config')),
  batch_id           UUID REFERENCES public.payout_batches(id) ON DELETE SET NULL,
  chunk_index        INT,
  transaction_index  BIGINT NOT NULL,
  payment_ids        TEXT[] NOT NULL DEFAULT '{}',
  summary            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id TEXT NOT NULL,
  -- draft: built but not yet seen on-chain. Others mirror the chain.
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'approved', 'executed', 'rejected', 'cancelled', 'stale')),
  create_signature   TEXT,
  execute_signature  TEXT,
  -- Rent of the proposal's on-chain accounts is returned to our fee payer once it is finished.
  rent_closed_at     TIMESTAMPTZ,
  rent_close_attempts INT NOT NULL DEFAULT 0,
  UNIQUE (partner_id, transaction_index)
);
CREATE INDEX IF NOT EXISTS partner_treasury_proposals_partner_idx ON public.partner_treasury_proposals (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_treasury_proposals_batch_idx ON public.partner_treasury_proposals (batch_id) WHERE batch_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_partner_treasury_proposals_updated_at ON public.partner_treasury_proposals;
CREATE TRIGGER trg_partner_treasury_proposals_updated_at
BEFORE UPDATE ON public.partner_treasury_proposals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Security: all access goes through service-role API routes
ALTER TABLE public.partner_treasury_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_treasury_proposals FROM anon, authenticated;
