-- Audit log for claim/payment flow (what happened, when, why). No PII.
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid REFERENCES public.claims(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ref_or_hash text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_claim_id ON public.payment_events(claim_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_created_at ON public.payment_events(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_event_type ON public.payment_events(event_type);

COMMENT ON TABLE public.payment_events IS 'Operator audit: claim created, quote/deposit, payment detected, attestation, failures';
