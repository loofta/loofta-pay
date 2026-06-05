-- Update type column to 4 specific prospect categories
ALTER TABLE outreach_prospects
  DROP CONSTRAINT IF EXISTS outreach_prospects_type_check;

ALTER TABLE outreach_prospects
  ADD CONSTRAINT outreach_prospects_type_check
  CHECK (type IN ('creator', 'KOL', 'freelancer', 'web3_project'));

-- Migrate old values
UPDATE outreach_prospects SET type = 'freelancer'    WHERE type = 'individual';
UPDATE outreach_prospects SET type = 'web3_project'  WHERE type = 'team';

-- Add per-type message templates to config
ALTER TABLE outreach_config
  ADD COLUMN IF NOT EXISTS creator_pitch     TEXT NOT NULL DEFAULT 'Get paid for your content and collabs in USDC — instantly, privately, no wallet history exposed to brands.',
  ADD COLUMN IF NOT EXISTS kol_pitch         TEXT NOT NULL DEFAULT 'Get paid for promos and partnerships in USDC in seconds. No invoices, no bank, full privacy.',
  ADD COLUMN IF NOT EXISTS freelancer_pitch  TEXT NOT NULL DEFAULT 'Get paid across borders in USDC instantly. No bank account required, no fees, no wallet history.',
  ADD COLUMN IF NOT EXISTS web3_project_pitch TEXT NOT NULL DEFAULT 'Pay your contributors privately in USDC — no gas complexity, no public payment history, works for any wallet.';
