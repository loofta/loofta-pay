-- Add sender_user_id for stable sender identity tracking
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS sender_user_id TEXT;
CREATE INDEX IF NOT EXISTS payments_sender_user_id_idx
  ON public.payments (sender_user_id) WHERE sender_user_id IS NOT NULL;

-- Backfill from_sender payments from created_by
UPDATE public.payments
SET sender_user_id = created_by
WHERE direction = 'from_sender'
  AND created_by IS NOT NULL
  AND sender_user_id IS NULL;

-- Records with no direction set: treat as from_sender
UPDATE public.payments
SET sender_user_id = created_by
WHERE (direction IS NULL OR direction = '')
  AND created_by IS NOT NULL
  AND sender_user_id IS NULL;

-- Rebuild payments_safe view to include sender_user_id
DROP VIEW IF EXISTS public.payments_safe;
CREATE VIEW public.payments_safe AS
SELECT
  id,
  created_at,
  updated_at,
  created_by,
  sender_user_id,
  amount,
  direction,
  recipient_username,
  recipient_user_id,
  status,
  paid_at,
  sender_tx_hash,
  sweep_tx_hash,
  description,
  from_chain,
  from_token,
  to_chain,
  to_token,
  is_devnet,
  legacy_claim_id
FROM public.payments;
ALTER VIEW public.payments_safe SET (security_invoker = true);
