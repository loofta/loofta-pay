-- Owners must accept the auto-pay terms in-app before the bot can spend from their wallet.
-- Records which version of the text they accepted and when.
ALTER TABLE public.twitter_autopay_enrollments
  ADD COLUMN IF NOT EXISTS terms_version     TEXT,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
