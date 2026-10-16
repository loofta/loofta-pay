-- Team auto-pay on X: an enrolled wallet owner (a person or a business) sets hard spend limits
-- and names the X handles ("approvers") allowed to tell @looftapay to spend from that wallet.
-- Limits are enforced server-side on every auto-pay, on top of the Privy policy on the wallet grant.
ALTER TABLE public.twitter_autopay_enrollments
  ADD COLUMN IF NOT EXISTS per_payment_cap_usd NUMERIC(12,2) NOT NULL DEFAULT 25 CHECK (per_payment_cap_usd > 0),
  ADD COLUMN IF NOT EXISTS daily_cap_usd       NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (daily_cap_usd > 0);

CREATE TABLE IF NOT EXISTS public.twitter_autopay_approvers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrollment_id  UUID NOT NULL REFERENCES public.twitter_autopay_enrollments(id) ON DELETE CASCADE,
  approver_handle TEXT NOT NULL,                  -- normalised, no leading @
  UNIQUE (enrollment_id, approver_handle)
);
CREATE INDEX IF NOT EXISTS twitter_autopay_approvers_handle_idx
ON public.twitter_autopay_approvers (approver_handle);

ALTER TABLE public.twitter_autopay_approvers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_twitter_autopay_approvers ON public.twitter_autopay_approvers;
CREATE POLICY deny_all_twitter_autopay_approvers ON public.twitter_autopay_approvers FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.twitter_autopay_approvers FROM anon, authenticated;

-- Who actually funded an auto-paid request (the wallet owner), so the daily cap can be summed
-- per wallet, plus which approver issued the command.
ALTER TABLE public.twitter_payment_requests
  ADD COLUMN IF NOT EXISTS funded_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_by_handle TEXT;
CREATE INDEX IF NOT EXISTS twitter_payment_requests_funder_idx
ON public.twitter_payment_requests (funded_by_user_id, created_at) WHERE funded_by_user_id IS NOT NULL;
