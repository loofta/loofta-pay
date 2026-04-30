-- Track whether the recipient was unregistered (no Loofta account) at payment creation time.
-- Persists even after the recipient claims and recipient_address/recipient_user_id are updated.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS recipient_was_unregistered BOOLEAN;

-- Backfill historical records: burner_address is only set at creation for unregistered recipients;
-- PENDING prefixes identify payments not yet claimed.
UPDATE public.payments
SET recipient_was_unregistered = TRUE
WHERE recipient_was_unregistered IS NULL
  AND (
    burner_address IS NOT NULL
    OR recipient_address LIKE 'PENDING_EMAIL:%'
    OR recipient_address LIKE 'PENDING_USERNAME:%'
  );
