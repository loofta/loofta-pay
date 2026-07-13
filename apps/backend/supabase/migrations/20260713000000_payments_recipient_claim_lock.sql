-- Guards the sender's "edit recipient" action (fix a typo on an unclaimed payment to an
-- unregistered recipient) against racing the recipient's own in-flight claim — claimAsRecipient
-- holds this lock for the duration of its burner sweep, before it commits the resolved wallet
-- address (see claims.service.ts claimAsRecipient / updateClaimRecipient).
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS recipient_claim_lock_at timestamptz;
