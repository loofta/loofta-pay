-- PAJ Cash (Naira on/off-ramp) integration: per-user session/link state, saved bank
-- accounts, and onramp/offramp orders. Service-role only; no client-side PostgREST.

create table if not exists public.paj_cash_sessions (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            text        not null unique,
  recipient          text        not null,
  recipient_type     text        not null check (recipient_type in ('email','phone')),
  session_token_enc  text        not null,
  expires_at         timestamptz not null,
  kyc_status         text        not null default 'unknown' check (kyc_status in ('unknown','not_required','pending','verified','rejected')),
  kyc_id_type        text        check (kyc_id_type in ('BVN','NIN')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists paj_cash_sessions_user_id_idx
  on public.paj_cash_sessions (user_id);

create table if not exists public.paj_cash_bank_accounts (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               text        not null,
  paj_bank_account_id   text        not null,
  bank_id               text        not null,
  bank_name             text        not null,
  account_number        text        not null,
  account_name          text        not null,
  created_at            timestamptz not null default now()
);

create index if not exists paj_cash_bank_accounts_user_id_idx
  on public.paj_cash_bank_accounts (user_id, created_at desc);

create unique index if not exists paj_cash_bank_accounts_user_paj_id_idx
  on public.paj_cash_bank_accounts (user_id, paj_bank_account_id);

create table if not exists public.paj_cash_orders (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   text        not null,
  direction                 text        not null check (direction in ('ON_RAMP','OFF_RAMP')),
  paj_order_id              text        unique,
  currency                  text        not null default 'NGN',
  fiat_amount               numeric(20,2),
  amount_usdc               numeric(20,6),
  rate                      numeric(20,6),
  fee_usdc                  numeric(20,6),
  onramp_bank_name          text,
  onramp_account_number     text,
  onramp_account_name       text,
  offramp_deposit_address   text,
  offramp_bank_account_id   text,
  offramp_tx_signature      text,
  status                    text        not null default 'CREATED'
                            check (status in ('CREATED','AWAITING_PAYMENT','USDC_SENT','PAJ_PAID','COMPLETE','FAILED','CANCELLED','EXPIRED')),
  last_reconciled_at        timestamptz,
  error_message             text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  completed_at              timestamptz
);

create index if not exists paj_cash_orders_user_id_idx
  on public.paj_cash_orders (user_id, created_at desc);

create index if not exists paj_cash_orders_status_idx
  on public.paj_cash_orders (status);

-- All access goes through the backend's service-role client; no client-side PostgREST.
alter table public.paj_cash_sessions enable row level security;
revoke all on public.paj_cash_sessions from anon, authenticated;

alter table public.paj_cash_bank_accounts enable row level security;
revoke all on public.paj_cash_bank_accounts from anon, authenticated;

alter table public.paj_cash_orders enable row level security;
revoke all on public.paj_cash_orders from anon, authenticated;
