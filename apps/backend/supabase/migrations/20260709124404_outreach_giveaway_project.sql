-- New prospect category: crypto projects currently running their own giveaway /
-- reward campaign. Different angle from web3_project's "pay contributors privately" —
-- this pitch is co-marketing + using Loofta Pay to pay out their giveaway winners.
ALTER TABLE outreach_prospects
  DROP CONSTRAINT IF EXISTS outreach_prospects_type_check;

ALTER TABLE outreach_prospects
  ADD CONSTRAINT outreach_prospects_type_check
  CHECK (type IN ('creator', 'KOL', 'freelancer', 'web3_project', 'giveaway_project'));

ALTER TABLE outreach_config
  ADD COLUMN IF NOT EXISTS giveaway_project_pitch TEXT NOT NULL DEFAULT 'Hey, Lisa here from Loofta Pay. Saw you''re running a giveaway right now, is that still live? We''d love to co-market it with you and cover payouts through Loofta Pay, so winners can claim straight to their bank or wallet, no crypto knowledge needed. Want to chat?';
