-- A per-user payout vault: a Squads multisig of the user's own wallet and a Loofta co-signer key, threshold 2.
-- Partner money for cash-outs that start inside Loofta waits here, separate from the user's Loofta balance.
-- Money can only leave through an exit that pays the partner fee and Loofta fee in the same transaction.
CREATE TABLE IF NOT EXISTS public.payout_vaults (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  multisig_pda  TEXT NOT NULL,
  vault_address TEXT NOT NULL,
  user_wallet   TEXT NOT NULL,
  cosigner      TEXT NOT NULL,
  is_devnet     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_vaults_user_idx ON public.payout_vaults(user_id, is_devnet);
CREATE UNIQUE INDEX IF NOT EXISTS payout_vaults_vault_idx ON public.payout_vaults(vault_address);

-- One exit at a time per vault and partner: the exit owns the credits it spends until it finishes or is cancelled.
CREATE TABLE IF NOT EXISTS public.payout_vault_exits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id          UUID NOT NULL REFERENCES public.payout_vaults(id),
  user_id           TEXT NOT NULL,
  partner_id        UUID NOT NULL,
  transaction_index BIGINT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'executed', 'cancelled', 'failed')),
  destination       TEXT NOT NULL,
  gross_units       BIGINT NOT NULL CHECK (gross_units > 0),
  net_units         BIGINT NOT NULL CHECK (net_units > 0),
  fee_lines         JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_hash      TEXT NOT NULL,
  approve_signature TEXT,
  execute_signature TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_vault_exits_index_idx ON public.payout_vault_exits(vault_id, transaction_index);
CREATE UNIQUE INDEX IF NOT EXISTS payout_vault_exits_open_idx ON public.payout_vault_exits(vault_id, partner_id) WHERE status = 'proposed';

-- Money that reached the vault from one partner payout. exit_id is set while an exit spends it.
CREATE TABLE IF NOT EXISTS public.payout_vault_credits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id    UUID NOT NULL REFERENCES public.payout_vaults(id),
  partner_id  UUID NOT NULL,
  payment_id  UUID NOT NULL REFERENCES public.payments(id),
  units       BIGINT NOT NULL CHECK (units > 0),
  exit_id     UUID REFERENCES public.payout_vault_exits(id),
  credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_vault_credits_payment_idx ON public.payout_vault_credits(payment_id);
CREATE INDEX IF NOT EXISTS payout_vault_credits_vault_idx ON public.payout_vault_credits(vault_id, partner_id) WHERE exit_id IS NULL;

-- Security: all access goes through service-role API routes
ALTER TABLE public.payout_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_vault_exits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_vault_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_vaults FROM anon, authenticated;
REVOKE ALL ON public.payout_vault_exits FROM anon, authenticated;
REVOKE ALL ON public.payout_vault_credits FROM anon, authenticated;
