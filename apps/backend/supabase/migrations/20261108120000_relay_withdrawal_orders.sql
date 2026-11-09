-- Relay (relay.link) withdrawals reuse near_intents_withdrawal_orders so the existing sponsor
-- intent-binding (assertAtaCreationsAllowed -> nearIntentsOrderId -> deposit_address) covers them
-- without widening any program whitelist: the user just sends plain USDC to a Relay-issued
-- one-time deposit address. These columns let the same row say which provider quoted it, carry the
-- Relay requestId used for status polling, and record the USDC fee we charge so the sponsor can
-- refuse a transaction that does not actually pay it.

alter table public.near_intents_withdrawal_orders
  add column if not exists provider text not null default 'near-intents'
    check (provider in ('near-intents', 'relay')),
  add column if not exists provider_request_id text,
  add column if not exists fee_usdc numeric(20,6) not null default 0;

create index if not exists near_intents_withdrawal_orders_deposit_address_idx
  on public.near_intents_withdrawal_orders (deposit_address);
