-- Bulk-send jobs used to run as a server-side "fire and forget" background loop, which
-- silently dies whenever the Node process recycles (dev server reload, serverless freeze).
-- Freezing the prospect list + a cursor lets any client (even a fresh page load) resume
-- a running job exactly where it left off, one send at a time, with no server-side loop.
alter table outreach_bulk_jobs
  add column if not exists prospect_ids uuid[] not null default '{}',
  add column if not exists next_index   int not null default 0;
