alter table outreach_prospects
  add column if not exists profile_image_url text,
  add column if not exists followers_count   integer;
