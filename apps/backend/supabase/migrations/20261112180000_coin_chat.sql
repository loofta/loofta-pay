-- Per-coin chat for the Telegram mini app. Each message keeps a snapshot of how much of the coin
-- the poster held when they wrote it, so readers can weigh who is talking.
-- Server only: RLS on, no access for anon or authenticated, the backend uses the service role.

CREATE TABLE IF NOT EXISTS public.coin_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint TEXT NOT NULL,
  privy_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  holding_amount NUMERIC,          -- coin units held at post time, NULL if it could not be read
  holding_pct NUMERIC,             -- share of total supply, 0..100
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coin_chat_mint_created ON public.coin_chat_messages(mint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_chat_user_created ON public.coin_chat_messages(privy_user_id, created_at DESC);

ALTER TABLE public.coin_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coin_chat_messages FROM anon, authenticated;
