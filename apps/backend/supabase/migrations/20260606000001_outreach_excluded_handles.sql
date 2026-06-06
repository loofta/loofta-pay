create table if not exists outreach_excluded_handles (
  handle      text primary key,
  excluded_at timestamptz not null default now()
);
