CREATE TABLE IF NOT EXISTS offramp_requests (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       TEXT NOT NULL,
  platform                      TEXT NOT NULL,
  platform_identifier           TEXT NOT NULL,
  currency                      TEXT NOT NULL DEFAULT 'USD',
  amount_usdc                   NUMERIC(20,6) NOT NULL,
  user_solana_address           TEXT NOT NULL,
  near_intents_deposit_address  TEXT,
  near_intents_memo             TEXT,
  near_intents_status           TEXT,
  zkp2p_deposit_id              TEXT,
  zkp2p_tx_hash                 TEXT,
  -- PENDING_BRIDGE → BRIDGING → CREATING_DEPOSIT → DEPOSITED → COMPLETE | CANCELLING → CANCELLED | FAILED
  status                        TEXT NOT NULL DEFAULT 'PENDING_BRIDGE',
  error_message                 TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at                  TIMESTAMPTZ,
  completed_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS offramp_requests_user_id_idx   ON offramp_requests(user_id);
CREATE INDEX IF NOT EXISTS offramp_requests_status_idx    ON offramp_requests(status);
CREATE INDEX IF NOT EXISTS offramp_requests_created_at_idx ON offramp_requests(created_at DESC);
