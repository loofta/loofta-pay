-- Predictions shown in the mini app feed, and a switch for people who do not want their activity shown.
-- Server only: RLS on, no access for anon or authenticated, the backend uses the service role.
-- Titles come from Jupiter by market id and the amount is read from the signed transaction on chain, never taken from the app.

CREATE TABLE IF NOT EXISTS public.mini_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('prediction', 'combo')),
  event_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  amount_usd NUMERIC NOT NULL DEFAULT 0,
  image TEXT,
  signature TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mini_activity_created ON public.mini_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mini_activity_user ON public.mini_activity(privy_user_id, created_at DESC);

ALTER TABLE public.mini_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mini_activity FROM anon, authenticated;

ALTER TABLE public.mini_profiles ADD COLUMN IF NOT EXISTS share_activity BOOLEAN NOT NULL DEFAULT TRUE;

-- A name people choose for the feed. It is never taken from Telegram, X or email unless the person picks it themselves.
ALTER TABLE public.mini_profiles ADD COLUMN IF NOT EXISTS handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mini_profiles_handle ON public.mini_profiles (lower(handle)) WHERE handle IS NOT NULL;
