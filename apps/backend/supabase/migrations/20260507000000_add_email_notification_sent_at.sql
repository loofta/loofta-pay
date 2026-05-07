-- Track when a claim notification email was sent to prevent duplicate sends.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS email_notification_sent_at TIMESTAMPTZ;
ALTER TABLE claims   ADD COLUMN IF NOT EXISTS email_notification_sent_at TIMESTAMPTZ;
