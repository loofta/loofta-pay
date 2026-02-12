-- Deals (freelancer product): deal with description, attach contract, invite freelancer.
-- Freelancer profile: address, TVA, verify service, optional KYC for invoicing.

-- Freelancer profiles (one per user; used across deals for invoicing details)
CREATE TABLE IF NOT EXISTS public.freelancer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE, -- Privy user ID
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  wallet_address TEXT,
  preferred_network TEXT,
  preferred_token_symbol TEXT,
  -- Invoicing
  billing_address TEXT,
  tva_number TEXT, -- VAT number
  verify_service TEXT, -- e.g. provider name for verification
  verify_status TEXT NOT NULL DEFAULT 'pending' CHECK (verify_status IN ('pending', 'verified', 'rejected')),
  kyc_required BOOLEAN NOT NULL DEFAULT false,
  kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected', 'not_required')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_user ON public.freelancer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_freelancer_profiles_email ON public.freelancer_profiles(email);

-- Deals (client creates deal; can attach contract)
CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.payroll_organizations(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  contract_attachment_path TEXT, -- storage path in bucket 'deal-contracts'
  amount TEXT NOT NULL,
  amount_currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'invited', 'accepted', 'funded', 'delivered', 'released', 'disputed', 'cancelled'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_org ON public.deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON public.deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON public.deals(created_at DESC);

-- Deal invites (invite freelancer by email or link to existing profile)
CREATE TABLE IF NOT EXISTS public.deal_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  freelancer_profile_id UUID REFERENCES public.freelancer_profiles(id) ON DELETE SET NULL,
  invitee_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
  preferred_network TEXT,
  preferred_token_symbol TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(deal_id, invitee_email)
);

CREATE INDEX IF NOT EXISTS idx_deal_invites_deal ON public.deal_invites(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_invites_email ON public.deal_invites(invitee_email);
CREATE INDEX IF NOT EXISTS idx_deal_invites_profile ON public.deal_invites(freelancer_profile_id) WHERE freelancer_profile_id IS NOT NULL;

-- Storage bucket for deal contract attachments (PDF, etc.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-contracts',
  'deal-contracts',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: freelancer_profiles — users can read/update their own
ALTER TABLE public.freelancer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own freelancer profile"
  ON public.freelancer_profiles FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can insert own freelancer profile"
  ON public.freelancer_profiles FOR INSERT
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can update own freelancer profile"
  ON public.freelancer_profiles FOR UPDATE
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- RLS: deals — org members can view; org owners/admins can manage
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view deals"
  ON public.deals FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = deals.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = deals.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  );

CREATE POLICY "Org admins can manage deals"
  ON public.deals FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = deals.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = deals.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub' AND m.role IN ('owner', 'admin'))
  );

-- RLS: deal_invites — tied to deal access; freelancer can view/update own invite (by email match or profile)
ALTER TABLE public.deal_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deal org can view and manage invites"
  ON public.deal_invites FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_invites.deal_id
      AND (
        EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = d.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
        OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = d.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub' AND m.role IN ('owner', 'admin'))
      )
    )
  );

CREATE POLICY "Freelancer can view own invite"
  ON public.deal_invites FOR SELECT
  USING (
    freelancer_profile_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.freelancer_profiles fp WHERE fp.id = deal_invites.freelancer_profile_id AND fp.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  );

CREATE POLICY "Freelancer can update own invite (accept/decline)"
  ON public.deal_invites FOR UPDATE
  USING (
    freelancer_profile_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.freelancer_profiles fp WHERE fp.id = deal_invites.freelancer_profile_id AND fp.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
  );

-- Storage policies for deal-contracts: org members can upload for their deals
CREATE POLICY "Authenticated can upload deal contracts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deal-contracts');

CREATE POLICY "Authenticated can read deal contracts"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deal-contracts');

CREATE POLICY "Authenticated can update deal contracts"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'deal-contracts');

CREATE POLICY "Authenticated can delete deal contracts"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deal-contracts');

-- Trigger updated_at
CREATE TRIGGER trg_freelancer_profiles_updated_at
  BEFORE UPDATE ON public.freelancer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_deal_invites_updated_at
  BEFORE UPDATE ON public.deal_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.freelancer_profiles IS 'Freelancer invoicing and payout details; optional KYC/verify';
COMMENT ON TABLE public.deals IS 'Freelancer deals: description, instructions, optional contract attachment';
COMMENT ON TABLE public.deal_invites IS 'Invited freelancer per deal; accept sets preferred token/chain';
