-- Account suspension. A suspended user keeps their row (and any funds they hold) but AuthGuard
-- rejects every authenticated request. Added 2026-11-06 after a fee-payer drain run through
-- rotating throwaway accounts sending 0.01 USDC to fresh recipients.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

CREATE INDEX IF NOT EXISTS app_users_suspended_idx
  ON public.app_users (privy_user_id)
  WHERE suspended_at IS NOT NULL;
