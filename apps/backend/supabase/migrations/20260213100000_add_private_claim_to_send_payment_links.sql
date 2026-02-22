-- Add optional private (Privacy Cash) claim link data when funded via vault
ALTER TABLE public.send_payment_links
  ADD COLUMN IF NOT EXISTS private_claim_activity_id TEXT,
  ADD COLUMN IF NOT EXISTS private_claim_passphrase TEXT;

COMMENT ON COLUMN public.send_payment_links.private_claim_activity_id IS 'Privacy Cash claim activity ID when funded via Pay privately';
COMMENT ON COLUMN public.send_payment_links.private_claim_passphrase IS 'Passphrase for recipient to claim private payment';
