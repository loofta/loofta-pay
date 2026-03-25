-- Harden function search_path and RLS policies.
-- This migration is defensive and idempotent for environments where some
-- tables/policies may exist only in hosted DB.

-- 1) Fix function_search_path_mutable warnings.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_updated_at_column'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    execute 'alter function public.update_updated_at_column() set search_path = pg_catalog, public';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    execute 'alter function public.set_updated_at() set search_path = pg_catalog, public';
  end if;
end
$$;

-- 2) Fix permissive INSERT policy on payroll_events.
do $$
begin
  if to_regclass('public.payroll_events') is not null then
    execute 'drop policy if exists "System can insert payroll events" on public.payroll_events';
    execute 'create policy "System can insert payroll events" on public.payroll_events for insert with check (auth.role() = ''service_role'')';
  end if;
end
$$;

-- 3) Resolve rls_enabled_no_policy by adding explicit deny-all policies.
-- This keeps RLS posture strict and explicit for linter + security reviews.
do $$
declare
  t text;
  policy_name text;
begin
  foreach t in array array[
    'app_users',
    'claims',
    'claim_intents',
    'claim_events',
    'organizations',
    'organization_payments',
    'payment_events',
    'off_ramp_deposits',
    'send_payment_links'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      policy_name := 'deny_all_' || t;
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', policy_name, t);
      execute format(
        'create policy %I on public.%I for all using (false) with check (false)',
        policy_name,
        t
      );
    end if;
  end loop;
end
$$;
