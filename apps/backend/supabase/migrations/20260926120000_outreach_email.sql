-- Email as a second outreach channel next to X DMs. A prospect keeps its X handle
-- (still the unique key) and can optionally carry an email to reach out on.
ALTER TABLE outreach_prospects
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_subject TEXT;

ALTER TABLE outreach_prospects
  DROP CONSTRAINT IF EXISTS outreach_prospects_sent_via_check;

ALTER TABLE outreach_prospects
  ADD CONSTRAINT outreach_prospects_sent_via_check
  CHECK (sent_via IN ('dm', 'reply', 'email'));
