-- One row per fee taken on a partner payout, so Loofta's fee and the partner's fee are recorded separately and a new
-- kind of fee later is a new row, not a new column. status is 'collected' today (taken in the sweep); 'held',
-- 'released' and 'refunded' are reserved for fees that are held until a cash-out starts.
CREATE TABLE IF NOT EXISTS public.partner_payment_fee_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  partner_id  UUID NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('partner', 'loofta')),
  units       BIGINT NOT NULL CHECK (units > 0),
  destination TEXT,
  status      TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'held', 'released', 'refunded')),
  stamped_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A retry of the same withdrawal can never record the same fee twice.
CREATE UNIQUE INDEX IF NOT EXISTS partner_payment_fee_lines_payment_kind_idx ON public.partner_payment_fee_lines(payment_id, kind);
CREATE INDEX IF NOT EXISTS partner_payment_fee_lines_partner_idx ON public.partner_payment_fee_lines(partner_id, kind);

-- Security: all access goes through service-role API routes
ALTER TABLE public.partner_payment_fee_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_payment_fee_lines FROM anon, authenticated;
