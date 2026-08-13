-- twitter_autopay_enrollments: which Loofta users have opted into the Twitter bot
-- ("give Loofta access to fund payments" — grants a Privy authorization key as an additional
-- signer on their own wallet, see useSigners().addSigners() on the frontend). Admin-only for now
-- (see isPrivyUserAdmin gate on the enroll/unenroll endpoints) — this is the enrollment gate the
-- bot checks before ever replying to a tweet: unenrolled senders are silently ignored.
CREATE TABLE IF NOT EXISTS public.twitter_autopay_enrollments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id          TEXT NOT NULL UNIQUE,           -- Privy user id
  twitter_handle   TEXT NOT NULL,                  -- normalised, no leading @ — what the bot matches on
  enabled          BOOLEAN NOT NULL DEFAULT false,
  signer_granted   BOOLEAN NOT NULL DEFAULT false  -- completed the Privy addSigners step
);
CREATE INDEX IF NOT EXISTS twitter_autopay_enrollments_handle_idx
ON public.twitter_autopay_enrollments (twitter_handle) WHERE enabled = true;

DROP TRIGGER IF EXISTS trg_twitter_autopay_enrollments_updated_at ON public.twitter_autopay_enrollments;
CREATE TRIGGER trg_twitter_autopay_enrollments_updated_at
BEFORE UPDATE ON public.twitter_autopay_enrollments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.twitter_autopay_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_twitter_autopay_enrollments ON public.twitter_autopay_enrollments;
CREATE POLICY deny_all_twitter_autopay_enrollments ON public.twitter_autopay_enrollments FOR ALL USING (false) WITH CHECK (false);
