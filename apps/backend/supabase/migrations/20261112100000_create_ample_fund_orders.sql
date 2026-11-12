-- Earn funding: moves a user's Solana USDC to their own Base wallet through Relay so it can be saved in the Base pool.
-- The row is created by the backend BEFORE any transaction is built. The sponsored broadcast only ever sends a transaction
-- that matches the Relay quote stored here exactly (see SolanaSponsorService.broadcastMatchedRelayDeposit), so a caller cannot
-- make the fee payer sign anything of their own invention.
CREATE TABLE IF NOT EXISTS ample_fund_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  solana_address  TEXT NOT NULL,
  base_address    TEXT NOT NULL,
  -- USDC base units (6 decimals)
  out_units       BIGINT NOT NULL,
  fee_units       BIGINT NOT NULL,
  total_units     BIGINT NOT NULL,
  quote           JSONB NOT NULL,
  request_id      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'BRIDGING', 'DONE', 'FAILED')),
  signature       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ample_fund_orders_user_idx ON ample_fund_orders(user_id, created_at DESC);

-- Security: all access goes through service-role API routes
ALTER TABLE public.ample_fund_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ample_fund_orders FROM anon, authenticated;
