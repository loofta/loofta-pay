-- Deal deadline, freelancer request changes, delivery, and pending payments

-- Deals: add deadline and delivery_confirmed_at
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ;

-- Deal invites: freelancer can request terms change (negotiate)
ALTER TABLE public.deal_invites
  ADD COLUMN IF NOT EXISTS request_changes_message TEXT;

-- Allow status 'request_changes' for deal_invites
ALTER TABLE public.deal_invites DROP CONSTRAINT IF EXISTS deal_invites_status_check;
ALTER TABLE public.deal_invites
  ADD CONSTRAINT deal_invites_status_check
  CHECK (status IN ('invited', 'accepted', 'declined', 'request_changes'));

-- Pending payments: created when org accepts delivery; paid via intent (single or bulk)
CREATE TABLE IF NOT EXISTS public.deal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  deal_invite_id UUID NOT NULL REFERENCES public.deal_invites(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.payroll_organizations(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  amount_currency TEXT NOT NULL DEFAULT 'USD',
  recipient_wallet TEXT NOT NULL,
  preferred_network TEXT NOT NULL,
  preferred_token_symbol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  deposit_address TEXT,
  intent_deadline TIMESTAMPTZ,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_payments_org ON public.deal_payments(organization_id);
CREATE INDEX IF NOT EXISTS idx_deal_payments_deal ON public.deal_payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_payments_status ON public.deal_payments(status);
CREATE INDEX IF NOT EXISTS idx_deal_payments_created ON public.deal_payments(created_at DESC);

ALTER TABLE public.deal_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org can view and manage deal_payments"
  ON public.deal_payments FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = deal_payments.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = deal_payments.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  );

CREATE TRIGGER trg_deal_payments_updated_at
  BEFORE UPDATE ON public.deal_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.deal_payments IS 'Pending payments from deals; created when org accepts delivery; paid via intent (bulk or single)';
