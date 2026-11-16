-- Takes on prediction events in the Telegram mini app. Only people who put at least $2 on the event can post,
-- checked on the backend against mini_activity. Server only: RLS on, no access for anon or authenticated.

CREATE TABLE IF NOT EXISTS public.event_takes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  privy_user_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  staked_usd NUMERIC NOT NULL DEFAULT 0,   -- what the poster had on this event when they wrote it
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_takes_event_created ON public.event_takes(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_takes_user_created ON public.event_takes(privy_user_id, created_at DESC);

ALTER TABLE public.event_takes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_takes FROM anon, authenticated;
