-- Rewards for the Telegram mini app: referrals, verified trades, badges and a weekly leaderboard.
-- Server only: RLS on, no access for anon or authenticated, the backend uses the service role.

-- One personal invite code per person.
CREATE TABLE IF NOT EXISTS public.mini_ref_codes (
  privy_user_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who invited whom. A person can only ever be invited once, and never by themselves.
-- qualified_at is set when the invited person makes their first confirmed trade.
CREATE TABLE IF NOT EXISTS public.mini_referrals (
  referee_privy_id TEXT PRIMARY KEY,
  referrer_privy_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qualified_at TIMESTAMPTZ,
  CHECK (referee_privy_id <> referrer_privy_id)
);
CREATE INDEX IF NOT EXISTS idx_mini_referrals_referrer ON public.mini_referrals(referrer_privy_id);

-- Every trade the backend built for the app. A row starts as 'built' and becomes 'confirmed' only after the
-- backend has checked the signature on chain. volume_usd is what the backend priced, never what the app says.
CREATE TABLE IF NOT EXISTS public.mini_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stock', 'preipo', 'meme', 'coin', 'predict')),
  side TEXT,
  mint TEXT,
  volume_usd NUMERIC NOT NULL DEFAULT 0,
  fee_bps INTEGER,
  fee_owner TEXT,
  fee_mint TEXT,                 -- 'SOL' for the native coin, otherwise the token mint the fee is paid in
  fee_amount NUMERIC,            -- base units
  gasless_id TEXT,               -- ties a sponsored swap's submit call back to its row
  status TEXT NOT NULL DEFAULT 'built' CHECK (status IN ('built', 'confirmed')),
  signature TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mini_trades_user ON public.mini_trades(privy_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mini_trades_week ON public.mini_trades(confirmed_at) WHERE status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_mini_trades_gasless ON public.mini_trades(gasless_id) WHERE gasless_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mini_badges (
  privy_user_id TEXT NOT NULL,
  badge TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (privy_user_id, badge)
);

-- Weekly leaderboard: confirmed volume per person since a moment in time.
CREATE OR REPLACE FUNCTION public.mini_leaderboard(since TIMESTAMPTZ, lim INTEGER)
RETURNS TABLE (privy_user_id TEXT, volume_usd NUMERIC, trades BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT t.privy_user_id, SUM(t.volume_usd) AS volume_usd, COUNT(*) AS trades
  FROM public.mini_trades t
  WHERE t.status = 'confirmed' AND t.kind <> 'predict' AND t.confirmed_at >= since
  GROUP BY t.privy_user_id
  HAVING SUM(t.volume_usd) > 0
  ORDER BY SUM(t.volume_usd) DESC
  LIMIT lim;
$$;

-- One person's weekly volume and rank (1 = top).
CREATE OR REPLACE FUNCTION public.mini_rank(uid TEXT, since TIMESTAMPTZ)
RETURNS TABLE (volume_usd NUMERIC, trades BIGINT, rank BIGINT)
LANGUAGE sql STABLE AS $$
  WITH totals AS (
    SELECT t.privy_user_id AS pid, SUM(t.volume_usd) AS vol, COUNT(*) AS n
    FROM public.mini_trades t
    WHERE t.status = 'confirmed' AND t.kind <> 'predict' AND t.confirmed_at >= since
    GROUP BY t.privy_user_id
  )
  SELECT me.vol, me.n, 1 + (SELECT COUNT(*) FROM totals o WHERE o.vol > me.vol)
  FROM totals me WHERE me.pid = uid;
$$;

ALTER TABLE public.mini_ref_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_badges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mini_ref_codes, public.mini_referrals, public.mini_trades, public.mini_badges FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mini_leaderboard(TIMESTAMPTZ, INTEGER), public.mini_rank(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
