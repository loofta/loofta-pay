-- Drop all deals, freelancer, and payroll tables (unused features).
-- Uses IF EXISTS so it is safe to apply against environments that never had them.

-- Deals / freelancer feature
DROP TABLE IF EXISTS public.deal_comments CASCADE;
DROP TABLE IF EXISTS public.deal_invites CASCADE;
DROP TABLE IF EXISTS public.deal_invoices CASCADE;
DROP TABLE IF EXISTS public.deal_payments CASCADE;
DROP TABLE IF EXISTS public.deals CASCADE;
DROP TABLE IF EXISTS public.freelancer_profiles CASCADE;

-- Payroll feature
DROP TABLE IF EXISTS public.payroll_run_entries CASCADE;
DROP TABLE IF EXISTS public.payroll_runs CASCADE;
DROP TABLE IF EXISTS public.payroll_intents CASCADE;
DROP TABLE IF EXISTS public.payroll_events CASCADE;
DROP TABLE IF EXISTS public.payroll_contributors CASCADE;
DROP TABLE IF EXISTS public.payroll_org_members CASCADE;
DROP TABLE IF EXISTS public.payroll_organizations CASCADE;
DROP TABLE IF EXISTS public.payroll_employees CASCADE;
DROP TABLE IF EXISTS public.payroll_batches CASCADE;
DROP TABLE IF EXISTS public.payroll_recipients CASCADE;
DROP TABLE IF EXISTS public.confidential_payments CASCADE;
