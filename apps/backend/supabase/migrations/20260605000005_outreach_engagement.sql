alter table outreach_prospects
  add column if not exists replied  boolean not null default false,
  add column if not exists followed boolean not null default false;
