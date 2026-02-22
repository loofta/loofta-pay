-- Columns for in-repo private (vault) claim flow; no external PRIVACY_CLAIM_API_URL
ALTER TABLE public.send_payment_links
  ADD COLUMN IF NOT EXISTS private_claim_sender_address TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_burner_address TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_encrypted_receiver TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_encrypted_sender TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_activity_id TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_passphrase TEXT;

COMMENT ON COLUMN public.send_payment_links.private_claim_sender_address IS 'Sender Solana address for private claim (set at prepare)';
COMMENT ON COLUMN public.send_payment_links.private_claim_burner_address IS 'Burner address for private claim (vault withdraw target)';
COMMENT ON COLUMN public.send_payment_links.private_claim_encrypted_receiver IS 'Encrypted burner key for recipient (passphrase)';
COMMENT ON COLUMN public.send_payment_links.private_claim_encrypted_sender IS 'Encrypted burner key for sender reclaim (session sig)';
COMMENT ON COLUMN public.send_payment_links.private_claim_activity_id IS 'Activity id for private claim (same as link id)';
COMMENT ON COLUMN public.send_payment_links.private_claim_passphrase IS 'Passphrase for recipient to decrypt burner key';

-- Reload PostgREST schema cache so API sees new columns (Supabase)
NOTIFY pgrst, 'reload schema';
