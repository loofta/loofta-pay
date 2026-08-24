-- Megapot ticket subscription: a fixed 30-day run where the user picks tickets/day at signup;
-- total_tickets and price_usdc both scale with that choice (base rate: $28 per 30 tickets, i.e.
-- 1/day for 30 days — $2 cheaper than buying 30 tickets one at a time). Auto-bought in daily batches instead
-- of one ticket at a time. See apps/backend/src/modules/lottery/megapot-subscription.service.ts.

CREATE TABLE IF NOT EXISTS megapot_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  total_tickets int NOT NULL,               -- tickets_per_day * 30 (fixed 30-day duration)
  tickets_per_day int NOT NULL,              -- user-chosen at signup, immutable
  price_usdc numeric(20, 6) NOT NULL,        -- tickets_per_day * 28
  -- User-picked ticket numbers, reused unchanged for every daily batch (array of
  -- {main:number[5], bonus:number}, length === tickets_per_day) — null means quick-pick
  -- (fresh random numbers bought each day, Megapot's own on-chain randomness).
  picked_numbers jsonb,
  payment_tx_hash text,
  tickets_bought int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',    -- active | completed | cancelled | expired
  started_at timestamptz NOT NULL DEFAULT now(),
  next_batch_due_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,          -- started_at + 30 months; safety cutoff only, see service
  last_batch_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  refund_tx_hash text,
  refund_usdc numeric(20, 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS megapot_subscriptions_payment_tx_hash_uq
  ON megapot_subscriptions (payment_tx_hash) WHERE payment_tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS megapot_subscriptions_user_id_idx ON megapot_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS megapot_subscriptions_due_idx
  ON megapot_subscriptions (next_batch_due_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS megapot_subscriptions_expires_idx
  ON megapot_subscriptions (expires_at) WHERE status = 'active';
-- At most one active subscription per user at a time.
CREATE UNIQUE INDEX IF NOT EXISTS megapot_subscriptions_one_active_per_user
  ON megapot_subscriptions (user_id) WHERE status = 'active';

ALTER TABLE megapot_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON megapot_subscriptions FROM anon, authenticated;
CREATE POLICY "service_megapot_subscriptions_all" ON megapot_subscriptions FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS megapot_subscription_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES megapot_subscriptions(id),
  batch_number int NOT NULL,
  num_tickets int NOT NULL,
  lottery_ticket_id uuid REFERENCES lottery_tickets(id),
  status text NOT NULL DEFAULT 'pending',   -- pending | bought | failed | refunded
  failure_reason text,
  retry_count int NOT NULL DEFAULT 0,
  refund_tx_hash text,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS megapot_subscription_batches_sub_idx
  ON megapot_subscription_batches (subscription_id);
CREATE INDEX IF NOT EXISTS megapot_subscription_batches_failed_idx
  ON megapot_subscription_batches (created_at) WHERE status = 'failed';

ALTER TABLE megapot_subscription_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON megapot_subscription_batches FROM anon, authenticated;
CREATE POLICY "service_megapot_subscription_batches_all" ON megapot_subscription_batches FOR ALL USING (true) WITH CHECK (true);
