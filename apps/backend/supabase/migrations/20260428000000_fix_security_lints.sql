-- Fix two Supabase security linter findings:
-- 1. security_definer_view on public.claims_safe  → switch to security_invoker
-- 2. rls_disabled_in_public on public.mainnet_waitlist → enable RLS + deny-all policy

-- 1) Remove SECURITY DEFINER from the claims_safe view.
--    security_invoker = true makes the view run with the querying user's privileges,
--    so Postgres RLS and permission checks are applied correctly.
do $$
begin
  if to_regclass('public.claims_safe') is not null then
    execute 'alter view public.claims_safe set (security_invoker = true)';
  end if;
end
$$;

-- 2) Enable RLS on mainnet_waitlist and add an explicit deny-all policy.
--    All access goes through the service-role key on server-side API routes;
--    no anon/authenticated client access is intended.
alter table public.mainnet_waitlist enable row level security;

drop policy if exists deny_all_mainnet_waitlist on public.mainnet_waitlist;
create policy deny_all_mainnet_waitlist
  on public.mainnet_waitlist
  for all
  using (false)
  with check (false);
