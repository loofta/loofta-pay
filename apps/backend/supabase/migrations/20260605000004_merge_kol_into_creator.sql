-- Migrate existing KOL records to creator
update outreach_prospects set type = 'creator' where type = 'KOL';

-- Drop old constraint and recreate without KOL
alter table outreach_prospects
  drop constraint if exists outreach_prospects_type_check;

alter table outreach_prospects
  add constraint outreach_prospects_type_check
  check (type in ('creator', 'freelancer', 'web3_project'));
