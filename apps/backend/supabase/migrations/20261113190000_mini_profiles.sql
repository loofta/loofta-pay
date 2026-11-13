-- Public face of a mini app member in the feed: profile picture and what they choose to show.
-- Server only: RLS on, no access for anon or authenticated, the backend uses the service role.
-- The picture URL is always read from the person's linked Telegram or X account by the backend, never taken from the app.

CREATE TABLE IF NOT EXISTS public.mini_profiles (
  privy_user_id TEXT PRIMARY KEY,
  avatar_kind TEXT NOT NULL DEFAULT 'color' CHECK (avatar_kind IN ('telegram', 'twitter', 'color')),
  avatar_url TEXT,                              -- set for telegram and twitter
  avatar_color TEXT,                            -- one of the preset keys, for 'color'
  show_pnl BOOLEAN NOT NULL DEFAULT TRUE,       -- show position and PnL on their posts
  hide_name BOOLEAN NOT NULL DEFAULT FALSE,     -- show "trader1a2b" instead of their username
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mini_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mini_profiles FROM anon, authenticated;

-- The feed reads the newest posts across every coin.
CREATE INDEX IF NOT EXISTS idx_coin_chat_created ON public.coin_chat_messages(created_at DESC);
