-- Enable useful extensions
create extension if not exists pgcrypto;

-- Users table (Privy-linked)
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  privy_user_id text unique,
  email text,
  username text unique,
  notify_email boolean not null default false,
  skip_onboarding boolean not null default false
  -- Keep wallet data out of core user record for minimal data retention
  -- If needed in future, consider a separate table with explicit consent.
  -- primary_wallet text,
  -- wallets jsonb
);

-- Index for username lookups
create index if not exists idx_app_users_username on public.app_users(username);

-- Claims: requested payouts
create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text null, -- Privy user ID (did:privy:...) who created the claim
  amount text not null, -- human-readable amount requested (e.g., "500")
  to_symbol text not null, -- e.g., "USDC"
  to_chain text not null,  -- e.g., "base"
  recipient_address text not null,
  notify_email_to text,
  status text not null default 'OPEN' check (status in ('OPEN','PENDING_DEPOSIT','IN_FLIGHT','SUCCESS','REFUNDED','EXPIRED','CANCELLED')),
  paid_at timestamptz
);

-- If previously created, drop wallet columns to minimize stored data
alter table if exists public.app_users drop column if exists primary_wallet;
alter table if exists public.app_users drop column if exists wallets;

-- Add paid_at column to claims table if it doesn't exist (for existing databases)
do $$ 
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'claims' 
    and column_name = 'paid_at'
  ) then
    alter table public.claims add column paid_at timestamptz;
  end if;
end $$;

create index if not exists claims_created_at_idx on public.claims (created_at desc);
create index if not exists claims_status_idx on public.claims (status);

-- Store prepared deposit/intents for a claim (optional but recommended)
create table if not exists public.claim_intents (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  quote_id text,
  deposit_address text,
  memo text,
  deadline timestamptz,
  time_estimate integer,
  status text,
  last_status_payload jsonb
);

create unique index if not exists claim_intents_deposit_addr_uidx on public.claim_intents (deposit_address) where deposit_address is not null;
create index if not exists claim_intents_claim_id_idx on public.claim_intents (claim_id);

-- Event log for claims (status transitions, pay attempts, webhooks)
create table if not exists public.claim_events (
  id bigserial primary key,
  claim_id uuid not null references public.claims(id) on delete cascade,
  created_at timestamptz not null default now(),
  type text not null,
  payload jsonb
);

create index if not exists claim_events_claim_id_idx on public.claim_events (claim_id, created_at desc);

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_claims_updated_at on public.claims;
create trigger trg_claims_updated_at
before update on public.claims
for each row execute function public.set_updated_at();

drop trigger if exists trg_claim_intents_updated_at on public.claim_intents;
create trigger trg_claim_intents_updated_at
before update on public.claim_intents
for each row execute function public.set_updated_at();

-- Optional: public view that hides recipient addresses
create or replace view public.public_claims as
select
  id,
  created_at,
  amount,
  to_symbol,
  to_chain,
  status
from public.claims;

-- RLS: keep enabled; no public policies by default
alter table public.app_users enable row level security;
alter table public.claims enable row level security;
alter table public.claim_intents enable row level security;
alter table public.claim_events enable row level security;

-- (No policies added here; server uses SUPABASE_SECRET on API routes.
-- If you later need client reads, add SELECT policies on public_claims
-- and avoid exposing recipient_address.)


