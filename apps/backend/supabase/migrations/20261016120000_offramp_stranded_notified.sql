-- Set once we have emailed the user that their cash out is waiting on them to approve the
-- Peer deposit. Stops the stranded-bridge cron from emailing the same row twice.
alter table public.offramp_requests
  add column if not exists stranded_notified_at timestamptz;
