-- Earn runs from a backend-held Rhinestone smart account ("companion") per user on Base, the same pattern as Megapot.
-- Rhinestone pays the gas, Ample's wallet link is signed by the account itself (ERC-1271, once deployed), and leftovers
-- can be swept. The owner key is stored encrypted (SendPaymentEncryptionService, context = the account address).
CREATE TABLE IF NOT EXISTS ample_companions (
  user_id     TEXT PRIMARY KEY,
  address     TEXT NOT NULL UNIQUE,
  key_enc     TEXT NOT NULL,
  deployed    BOOLEAN NOT NULL DEFAULT FALSE,
  swept_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ample_companions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ample_companions FROM anon, authenticated;

-- Orders now cover both directions and the backend-driven steps after the bridge.
--   fund:     Solana USDC -> (Relay) -> companion -> Ample deposit
--   withdraw: Ample withdraw -> companion -> (Relay) -> the user's Solana wallet
ALTER TABLE public.ample_fund_orders
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'fund' CHECK (kind IN ('fund', 'withdraw')),
  ADD COLUMN IF NOT EXISTS vault_id TEXT,
  ADD COLUMN IF NOT EXISTS step_hash TEXT,
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS recorded BOOLEAN NOT NULL DEFAULT FALSE;

-- withdraw orders have no pre-built Solana quote
ALTER TABLE public.ample_fund_orders ALTER COLUMN quote DROP NOT NULL;
ALTER TABLE public.ample_fund_orders ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE public.ample_fund_orders ALTER COLUMN base_address DROP NOT NULL;

ALTER TABLE public.ample_fund_orders DROP CONSTRAINT IF EXISTS ample_fund_orders_status_check;
ALTER TABLE public.ample_fund_orders
  ADD CONSTRAINT ample_fund_orders_status_check
  CHECK (status IN ('PENDING', 'BRIDGING', 'DEPOSITING', 'WITHDRAWING', 'RETURNING', 'DONE', 'FAILED'));

CREATE INDEX IF NOT EXISTS ample_fund_orders_open_idx ON ample_fund_orders(status) WHERE status NOT IN ('DONE', 'FAILED', 'PENDING');
