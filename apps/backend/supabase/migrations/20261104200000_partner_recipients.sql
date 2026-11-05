-- Recipients of partner payouts who have no Loofta account. Identified only by the partner's own
-- user id (external_user_id); they act through short-lived portal tokens the partner's server mints.
CREATE TABLE IF NOT EXISTS public.partner_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integrator_id     UUID NOT NULL REFERENCES public.integrators(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_user_id  TEXT NOT NULL,
  display_name      TEXT,
  UNIQUE (integrator_id, external_user_id)
);

-- Which partner recipient a payment is owed to (NULL for every normal payment).
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS partner_recipient_id UUID REFERENCES public.partner_recipients(id);
CREATE INDEX IF NOT EXISTS payments_partner_recipient_idx ON public.payments (partner_recipient_id) WHERE partner_recipient_id IS NOT NULL;

ALTER TABLE public.partner_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_partner_recipients ON public.partner_recipients;
CREATE POLICY deny_all_partner_recipients ON public.partner_recipients FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.partner_recipients FROM anon, authenticated;
