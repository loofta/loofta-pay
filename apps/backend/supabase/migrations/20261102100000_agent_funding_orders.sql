-- Funding an account from any token on any supported chain, through NEAR Intents (confidential when
-- available). The agent asks for a deposit address, the person sends the token, and we follow the order
-- until the USDC lands in their Loofta wallet, or the money is refunded, so we can tell them either way.

CREATE TABLE IF NOT EXISTS public.agent_funding_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id           TEXT NOT NULL,
  session_id        UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  from_symbol       TEXT NOT NULL,
  from_chain        TEXT NOT NULL,
  from_token_id     TEXT NOT NULL,
  amount_in         TEXT,                       -- what to send, human units (quoted)
  expected_usdc     NUMERIC(18,6),              -- what should arrive
  deposit_address   TEXT NOT NULL,
  memo              TEXT,
  deadline          TIMESTAMPTZ,
  confidentiality   TEXT NOT NULL DEFAULT 'public' CHECK (confidentiality IN ('public','basic','advanced')),
  refund_address    TEXT NOT NULL,
  recipient_address TEXT NOT NULL,              -- the person's own Loofta wallet, never supplied by the agent
  status            TEXT NOT NULL DEFAULT 'awaiting_deposit'
                    CHECK (status IN ('awaiting_deposit','processing','incomplete','received','refunded','failed','expired')),
  near_status       TEXT,
  received_usdc     NUMERIC(18,6),
  refunded_amount   TEXT,
  tx_hash           TEXT,
  notified_at       TIMESTAMPTZ,
  last_checked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_funding_orders_deposit_idx ON public.agent_funding_orders (deposit_address, COALESCE(memo, ''));
CREATE INDEX IF NOT EXISTS agent_funding_orders_open_idx ON public.agent_funding_orders (created_at) WHERE status IN ('awaiting_deposit','processing','incomplete');
CREATE INDEX IF NOT EXISTS agent_funding_orders_user_idx ON public.agent_funding_orders (user_id, created_at DESC);

ALTER TABLE public.agent_funding_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_agent_funding_orders ON public.agent_funding_orders;
CREATE POLICY deny_all_agent_funding_orders ON public.agent_funding_orders FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.agent_funding_orders FROM anon, authenticated;
