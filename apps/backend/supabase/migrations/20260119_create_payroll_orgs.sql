-- Payroll Organizations and Contributors
-- Enables users to create organizations and manage contributor payroll

-- Payroll Organizations (separate from checkout organizations)
CREATE TABLE IF NOT EXISTS public.payroll_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  owner_id TEXT NOT NULL, -- Privy user ID of the creator
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contributors (team members to be paid)
CREATE TABLE IF NOT EXISTS public.payroll_contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.payroll_organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  wallet_address TEXT,
  network TEXT, -- chain identifier (e.g., 'base', 'ethereum', 'polygon')
  token_symbol TEXT, -- preferred token (e.g., 'USDC', 'ETH')
  status TEXT NOT NULL DEFAULT 'invited', -- invited, joined, removed
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, email)
);

-- Organization members (who can manage the org)
CREATE TABLE IF NOT EXISTS public.payroll_org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.payroll_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, -- Privy user ID
  role TEXT NOT NULL DEFAULT 'member', -- owner, admin, member
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payroll_orgs_owner ON public.payroll_organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_payroll_contributors_org ON public.payroll_contributors(organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_contributors_email ON public.payroll_contributors(email);
CREATE INDEX IF NOT EXISTS idx_payroll_contributors_status ON public.payroll_contributors(status);
CREATE INDEX IF NOT EXISTS idx_payroll_org_members_org ON public.payroll_org_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_org_members_user ON public.payroll_org_members(user_id);

-- RLS Policies
ALTER TABLE public.payroll_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_org_members ENABLE ROW LEVEL SECURITY;

-- Policy: Org owners and members can view their organizations
CREATE POLICY "Users can view their organizations"
  ON public.payroll_organizations
  FOR SELECT
  USING (
    owner_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM public.payroll_org_members
      WHERE organization_id = id
      AND user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- Policy: Org owners can manage organizations
CREATE POLICY "Owners can manage their organizations"
  ON public.payroll_organizations
  FOR ALL
  USING (owner_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Policy: Org members can view contributors
CREATE POLICY "Members can view contributors"
  ON public.payroll_contributors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_org_members
      WHERE organization_id = payroll_contributors.organization_id
      AND user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
    OR EXISTS (
      SELECT 1 FROM public.payroll_organizations
      WHERE id = payroll_contributors.organization_id
      AND owner_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- Policy: Org owners/admins can manage contributors
CREATE POLICY "Admins can manage contributors"
  ON public.payroll_contributors
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_organizations
      WHERE id = payroll_contributors.organization_id
      AND owner_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
    OR EXISTS (
      SELECT 1 FROM public.payroll_org_members
      WHERE organization_id = payroll_contributors.organization_id
      AND user_id = current_setting('request.jwt.claims', true)::json->>'sub'
      AND role IN ('owner', 'admin')
    )
  );

-- Policy: Org members can view membership
CREATE POLICY "Members can view org members"
  ON public.payroll_org_members
  FOR SELECT
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM public.payroll_organizations
      WHERE id = payroll_org_members.organization_id
      AND owner_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- Comments
COMMENT ON TABLE public.payroll_organizations IS 'Organizations for payroll management';
COMMENT ON TABLE public.payroll_contributors IS 'Contributors/employees to be paid by organizations';
COMMENT ON TABLE public.payroll_org_members IS 'Members who can manage an organization';
COMMENT ON COLUMN public.payroll_contributors.status IS 'invited = pending, joined = accepted, removed = soft deleted';
COMMENT ON COLUMN public.payroll_contributors.network IS 'Blockchain network for payments (must match wallet address format)';
