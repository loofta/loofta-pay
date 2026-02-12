-- Add contributor_type to payroll_contributors (internal staff vs contractor)
ALTER TABLE public.payroll_contributors
  ADD COLUMN IF NOT EXISTS contributor_type TEXT;

COMMENT ON COLUMN public.payroll_contributors.contributor_type IS 'internal_staff or contractor';
