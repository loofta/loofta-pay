-- Fix Supabase linter security findings:
-- - security_definer_view on public.public_claims
-- - rls_disabled_in_public on several public tables

-- Ensure the view runs with querying user's privileges.
alter view if exists public.public_claims
  set (security_invoker = true);

-- Enable RLS on exposed public tables when they exist.
do $$
begin
  if to_regclass('public.organizations') is not null then
    execute 'alter table public.organizations enable row level security';
  end if;

  if to_regclass('public.organization_payments') is not null then
    execute 'alter table public.organization_payments enable row level security';
  end if;

  if to_regclass('public.payment_events') is not null then
    execute 'alter table public.payment_events enable row level security';
  end if;

  if to_regclass('public.off_ramp_deposits') is not null then
    execute 'alter table public.off_ramp_deposits enable row level security';
  end if;
end
$$;

-- Optional hardening: revoke direct access from PostgREST roles.
-- Policies can be added later if client-side access is required.
do $$
begin
  if to_regclass('public.organizations') is not null then
    execute 'revoke all on public.organizations from anon, authenticated';
  end if;

  if to_regclass('public.organization_payments') is not null then
    execute 'revoke all on public.organization_payments from anon, authenticated';
  end if;

  if to_regclass('public.payment_events') is not null then
    execute 'revoke all on public.payment_events from anon, authenticated';
  end if;

  if to_regclass('public.off_ramp_deposits') is not null then
    execute 'revoke all on public.off_ramp_deposits from anon, authenticated';
  end if;
end
$$;
