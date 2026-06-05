alter table outreach_prospects drop constraint if exists outreach_prospects_status_check;
alter table outreach_prospects add constraint outreach_prospects_status_check
  check (status in ('new', 'drafting', 'drafted', 'approved', 'rejected', 'sent', 'follow_pending'));
