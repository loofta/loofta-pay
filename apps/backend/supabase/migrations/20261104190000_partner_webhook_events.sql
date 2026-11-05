-- Outbox for partner webhooks. ClaimsService writes a row when a batch payout is funded/claimed;
-- PartnerWebhooksService delivers them with retries so an outage on the partner's side (or a
-- backend restart) never loses an event. One row per (payment, event type) = natural dedupe.
CREATE TABLE IF NOT EXISTS public.payout_webhook_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  integrator_id    UUID NOT NULL REFERENCES public.integrators(id) ON DELETE CASCADE,
  payment_id       UUID NOT NULL,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts         INT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ,
  last_error       TEXT,
  UNIQUE (payment_id, event_type)
);
CREATE INDEX IF NOT EXISTS payout_webhook_events_due_idx
  ON public.payout_webhook_events (next_attempt_at) WHERE status = 'pending';

ALTER TABLE public.payout_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_payout_webhook_events ON public.payout_webhook_events;
CREATE POLICY deny_all_payout_webhook_events ON public.payout_webhook_events FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.payout_webhook_events FROM anon, authenticated;
