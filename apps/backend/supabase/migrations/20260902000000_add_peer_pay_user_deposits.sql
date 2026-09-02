-- Peer Pay deposits: widen the type constraint to allow 'peer-pay' (new provider), plus
-- 'card-onramp' and 'usdc-wallet' — both already used by BalanceModal's recordDeposit() calls
-- but missing from the original constraint, so every one of those inserts has been silently
-- failing since they shipped.
alter table public.user_deposits drop constraint if exists user_deposits_type_check;
alter table public.user_deposits add constraint user_deposits_type_check
  check (type in ('blink','near-intents','coinbase','moonpay','card-onramp','usdc-wallet','peer-pay'));

-- Peer Pay order id, so the webhook handler (which only receives an order id, no deposit_address
-- guarantee) can find the matching row without relying on address matching.
alter table public.user_deposits add column if not exists provider_order_id text;

create index if not exists user_deposits_provider_order_id_idx
  on public.user_deposits (provider_order_id) where provider_order_id is not null;
