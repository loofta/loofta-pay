-- Fix Supabase linter finding: rls_disabled_in_public on public.user_deposits.
-- All access goes through service-role API routes; no client-side PostgREST needed.

alter table public.user_deposits enable row level security;
revoke all on public.user_deposits from anon, authenticated;
