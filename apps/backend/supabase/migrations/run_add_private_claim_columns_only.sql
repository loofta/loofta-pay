-- Run this in Supabase SQL Editor if you get:
--   "Could not find the 'private_claim_sender_address' column of 'send_payment_links' in the schema cache"
-- (Table exists but private-claim columns are missing. Safe to run multiple times.)

ALTER TABLE public.send_payment_links
  ADD COLUMN IF NOT EXISTS private_claim_sender_address TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_burner_address TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_encrypted_receiver TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_encrypted_sender TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_activity_id TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_passphrase TEXT;

NOTIFY pgrst, 'reload schema';
