create table if not exists public.user_deposits (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  type          text        not null check (type in ('blink','near-intents','coinbase','moonpay')),
  status        text        not null default 'pending' check (status in ('pending','complete','failed')),
  amount_usdc   numeric,
  deposit_address text,
  bridge_status text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists user_deposits_user_id_idx
  on public.user_deposits (user_id, created_at desc);
