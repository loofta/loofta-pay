-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  logo_url TEXT,
  checkout_status TEXT NOT NULL DEFAULT 'inactive' CHECK (checkout_status IN ('active', 'inactive')),
  org_referral TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT -- Privy user ID of admin who created it
);

-- Create index on organization_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_organizations_organization_id ON organizations(organization_id);

-- Create index on org_referral for payment tracking
CREATE INDEX IF NOT EXISTS idx_organizations_org_referral ON organizations(org_referral);

-- Create index on checkout_status for filtering active organizations
CREATE INDEX IF NOT EXISTS idx_organizations_checkout_status ON organizations(checkout_status);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

