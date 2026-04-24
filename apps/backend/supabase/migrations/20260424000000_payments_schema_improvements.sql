-- =====================================================
-- payments schema improvements
--
-- 1. Drop leftover org_referral column
-- 2. Add recipient_user_id (stable identity, won't change if username changes)
-- 3. Rename paid_with_chain → from_chain (clearer naming)
-- 4. Add from_token (what sender paid with)
-- 5. Add to_chain / to_token (what recipient receives — default USDC on Solana)
-- =====================================================

-- 1. Drop org_referral (migrated from claims by mistake, not part of payments design)
ALTER TABLE public.payments DROP COLUMN IF EXISTS org_referral;

-- 2. Add recipient_user_id for stable recipient identity tracking
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS recipient_user_id TEXT;
CREATE INDEX IF NOT EXISTS payments_recipient_user_id_idx
  ON public.payments (recipient_user_id) WHERE recipient_user_id IS NOT NULL;

-- 3. Rename paid_with_chain → from_chain (what the sender paid from)
ALTER TABLE public.payments RENAME COLUMN paid_with_chain TO from_chain;

-- 4. Add from_token (token the sender paid with, e.g. "USDC", "ETH")
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS from_token TEXT;

-- 5. Add to_chain / to_token (what the recipient receives)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS to_chain TEXT NOT NULL DEFAULT 'solana';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS to_token TEXT NOT NULL DEFAULT 'USDC';

-- Backfill to_chain / to_token
UPDATE public.payments
SET to_chain = 'solana', to_token = 'USDC'
WHERE to_chain IS NULL OR to_token IS NULL;

-- =====================================================
-- Rebuild payments_safe view with updated column set
-- =====================================================
DROP VIEW IF EXISTS public.payments_safe;
CREATE VIEW public.payments_safe AS
SELECT
  id,
  created_at,
  updated_at,
  created_by,
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
