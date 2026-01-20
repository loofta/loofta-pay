-- Add department column to payroll_contributors
-- Enables grouping contributors by department (marketing, finance, engineering, etc.)

ALTER TABLE public.payroll_contributors
ADD COLUMN IF NOT EXISTS department TEXT;

-- Add index for filtering by department
CREATE INDEX IF NOT EXISTS idx_payroll_contributors_department 
ON public.payroll_contributors(department);

-- Add comment
COMMENT ON COLUMN public.payroll_contributors.department IS 'Department/role for expense categorization (e.g., marketing, finance, engineering)';
