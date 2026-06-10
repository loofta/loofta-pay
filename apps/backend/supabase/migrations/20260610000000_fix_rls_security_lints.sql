-- Fix Supabase linter security findings:
-- rls_disabled_in_public on outreach, offramp, and earn tables.
-- All access goes through service-role API routes; no client-side PostgREST needed.

do $$
declare
  t text;
begin
  foreach t in array array[
    'public.outreach_prospects',
    'public.outreach_config',
    'public.outreach_bulk_jobs',
    'public.outreach_excluded_handles',
    'public.offramp_requests',
    'public.user_earn_settings',
    'public.user_earn_positions',
    'public.earn_transactions'
  ]
  loop
    if to_regclass(t) is not null then
      execute format('alter table %s enable row level security', t);
      execute format('revoke all on %s from anon, authenticated', t);
    end if;
  end loop;
end
$$;
