-- Add expires_at to payments for automatic link expiry (default 7 days)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payments_expires_at_idx
  ON public.payments (expires_at) WHERE expires_at IS NOT NULL;

-- Backfill: set expires_at = created_at + 7 days for existing OPEN payments
UPDATE public.payments
SET expires_at = created_at + INTERVAL '7 days'
WHERE status = 'OPEN'
  AND expires_at IS NULL;
