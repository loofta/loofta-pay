-- Contributor profile: address, business registration, KYC (for contributor info page)
ALTER TABLE public.payroll_contributors
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS business_registration_number TEXT,
  ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'not_started', -- not_started, pending, verified
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.payroll_contributors.kyc_status IS 'KYC status: not_started, pending, verified';
