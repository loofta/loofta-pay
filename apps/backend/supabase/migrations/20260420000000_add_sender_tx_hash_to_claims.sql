-- Add sender_tx_hash column to claims for RPC recovery flow.
-- Stores the Solana tx signature immediately after broadcast so the backend cron
-- can verify on-chain confirmation if RPC polling times out on the client side.
alter table public.claims
  add column if not exists sender_tx_hash text;

create index if not exists claims_sender_tx_hash_idx on public.claims (sender_tx_hash)
  where sender_tx_hash is not null;
