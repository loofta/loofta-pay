-- Tracks the per-batch throwaway burner used to fan out a private multi-send batch, replacing
-- the old shared-hub design. One row per multi_send_batch_id (see payments.multi_send_batch_id).
-- Durable state so retryStuckMultiSendBatches (cron) can resume a fan-out that died mid-flight
-- without re-paying any row already sent (idempotency is enforced at the payments row level via
-- sender_tx_hash, not by this table alone — see send-payment.service.ts).
CREATE TABLE IF NOT EXISTS multi_send_batches (
  id                      UUID PRIMARY KEY,
  sender_user_id          TEXT NOT NULL,
  sender_wallet           TEXT NOT NULL,
  burner_address          TEXT,
  burner_encrypted_secret TEXT,
  total_funded_base_units BIGINT,
  status                  TEXT NOT NULL DEFAULT 'AWAITING_FUNDING' CHECK (status IN (
                            'AWAITING_FUNDING', 'FUNDING_CONFIRMED', 'FANNING_OUT', 'COMPLETED', 'FAILED'
                          )),
  funding_tx_hash         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  funded_at               TIMESTAMPTZ,
  fan_out_started_at      TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  burner_reclaimed_at     TIMESTAMPTZ
);

-- Cron sweep: find batches stuck mid-flight past the grace window.
CREATE INDEX IF NOT EXISTS multi_send_batches_status_funded_at_idx
  ON multi_send_batches(status, funded_at);

-- Security: all access goes through service-role API routes
ALTER TABLE public.multi_send_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_send_batches FROM anon, authenticated;
