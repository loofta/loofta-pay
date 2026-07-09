CREATE TABLE IF NOT EXISTS beam_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  platform              TEXT NOT NULL,
  platform_identifier   TEXT NOT NULL,
  amount_usdc           NUMERIC(20,6) NOT NULL,
  amount_payout         NUMERIC(20,6) NOT NULL,
  base_wallet_address   TEXT NOT NULL,
  funding_method        TEXT NOT NULL,
  funding_reference     TEXT,
  zkp2p_deposit_id      TEXT,
  zkp2p_tx_hash         TEXT,
  -- PENDING_FUNDING → FUNDED → CREATING_DEPOSIT → DEPOSITED → COMPLETE | FAILED | CANCELLED
  status                TEXT NOT NULL DEFAULT 'PENDING_FUNDING',
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS beam_payments_user_id_idx    ON beam_payments(user_id);
CREATE INDEX IF NOT EXISTS beam_payments_status_idx     ON beam_payments(status);
CREATE INDEX IF NOT EXISTS beam_payments_created_at_idx ON beam_payments(created_at DESC);

-- Security: all access goes through service-role API routes
ALTER TABLE public.beam_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beam_payments FROM anon, authenticated;
