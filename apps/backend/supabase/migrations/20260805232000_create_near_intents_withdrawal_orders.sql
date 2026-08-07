-- Near Intents withdrawal orders: a real, backend-created record of the NEAR 1-click quote
-- BEFORE the user signs anything, so solana-sponsor.service.ts can verify the ATA it's about
-- to sponsor actually matches a deposit address we quoted ourselves (mirrors paj_cash_orders'
-- offramp_deposit_address pattern). Previously the quote was fetched client-side directly from
-- NEAR's public API with nothing backend-tracked to bind against — see project memory: solana
-- sponsor security hardening.

create table if not exists public.near_intents_withdrawal_orders (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             text        not null,
  from_token_id       text        not null,
  from_chain          text        not null,
  to_token_id         text        not null,
  to_chain            text        not null,
  amount_usdc         numeric(20,6) not null,
  destination_address text        not null, -- final recipient the user asked to withdraw to
  deposit_address      text        not null, -- NEAR-quoted deposit address; the expected sponsored-ATA owner
  memo                text,
  quote_id            text,
  deadline            timestamptz,
  is_devnet           boolean     not null default false,
  status              text        not null default 'CREATED'
                      check (status in ('CREATED','SENT','COMPLETE','FAILED','EXPIRED')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists near_intents_withdrawal_orders_user_id_idx
  on public.near_intents_withdrawal_orders (user_id, created_at desc);

-- All access goes through the backend's service-role client; no client-side PostgREST.
alter table public.near_intents_withdrawal_orders enable row level security;
revoke all on public.near_intents_withdrawal_orders from anon, authenticated;
