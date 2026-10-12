-- Remember the delay and split the depositor picked, so the burner → wallet
-- hop uses that schedule instead of the server default.

alter table public.private_transfers
  add column if not exists delivery_split integer,
  add column if not exists delivery_max_delay_ms integer;

comment on column public.private_transfers.delivery_split is
  'MagicBlock split for a private deposit delivery. Null keeps the server default.';
comment on column public.private_transfers.delivery_max_delay_ms is
  'MagicBlock max delivery delay in milliseconds. Null keeps the server default.';
