-- Invoices auto-generated when org accepts delivery (deal payment created)
CREATE TABLE IF NOT EXISTS public.deal_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  deal_payment_id UUID NOT NULL REFERENCES public.deal_payments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.payroll_organizations(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  amount_currency TEXT NOT NULL DEFAULT 'USD',
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'sent', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_invoices_org ON public.deal_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_deal_invoices_created ON public.deal_invoices(created_at DESC);

ALTER TABLE public.deal_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org can view deal_invoices"
  ON public.deal_invoices FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = deal_invoices.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = deal_invoices.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  );

COMMENT ON TABLE public.deal_invoices IS 'Invoices auto-generated when organization accepts delivery; one per deal payment';
