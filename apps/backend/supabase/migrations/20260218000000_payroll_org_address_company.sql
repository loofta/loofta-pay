-- Organization address and company info (for invoices, contracts)

ALTER TABLE public.payroll_organizations
  ADD COLUMN IF NOT EXISTS address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS company_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS company_registration_number TEXT;

COMMENT ON COLUMN public.payroll_organizations.company_legal_name IS 'Legal / registered company name for invoices';
COMMENT ON COLUMN public.payroll_organizations.company_registration_number IS 'VAT, EIN, company number, etc.';