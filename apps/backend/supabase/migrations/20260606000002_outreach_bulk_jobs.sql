create table outreach_bulk_jobs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  status         text not null default 'running',  -- 'running' | 'done' | 'stopped'
  total          int  not null default 0,
  sent           int  not null default 0,
  current_handle text,
  error          text,
  finished_at    timestamptz
);
