-- Public share code for pay-to-Venmo/Cash App/Revolut links.
alter table public.offramp_requests
  add column if not exists short_id text;

create unique index if not exists offramp_requests_short_id_idx
  on public.offramp_requests (short_id)
  where short_id is not null;
