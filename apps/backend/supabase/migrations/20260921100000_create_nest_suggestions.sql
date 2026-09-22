-- "Suggest, don't auto-trade" pivot (2026-09-21, see scripts/nest-backtest/RESULTS.md): the daily
-- engine no longer tilts weight by Elfa attention/sentiment (backtested, no edge). Instead, when a
-- symbol a user holds makes a real, large price move, we surface a suggested rebalance action
-- (trim the winner back to target, or buy the dip back to target) with the real news context
-- behind it, and the user explicitly accepts or dismisses it — nothing trades on its own.
--
-- nest_price_history is the "yesterday's close" this needs (nest_prices only ever holds the
-- latest quote, overwritten in place) — append-only, one row per symbol per day, and doubles as
-- the start of a real historical dataset for future strategy R&D instead of the backtest
-- script's ad-hoc local JSON cache.

CREATE TABLE IF NOT EXISTS nest_price_history (
  symbol     TEXT NOT NULL,
  day        DATE NOT NULL,
  price_usd  NUMERIC(18, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, day)
);

CREATE TABLE IF NOT EXISTS nest_suggestions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL, -- ledger user id (real Privy DID or devnet-demo suffixed, see nest-ledger-id.ts)
  symbol       TEXT NOT NULL,
  -- Dedup key for the detected event, e.g. "<symbol>:<day>" — at most one suggestion per user
  -- per detected event, regardless of status, so a re-scan before expiry doesn't spam a new row.
  event_key    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('trim', 'buy_dip')),
  delta_usd    NUMERIC(18, 2) NOT NULL, -- suggested $ amount at detection time; recomputed fresh on accept
  move_pct     NUMERIC(6, 4) NOT NULL, -- the price move that triggered this, signed
  reason       TEXT NOT NULL, -- human-readable event summary (Elfa event-summary), never a raw score
  source_links TEXT[] NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'expired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS nest_suggestions_user_event_idx ON nest_suggestions(user_id, event_key);
CREATE INDEX IF NOT EXISTS nest_suggestions_user_status_idx ON nest_suggestions(user_id, status);

-- Security: all access goes through service-role API routes
ALTER TABLE public.nest_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_price_history FROM anon, authenticated;
ALTER TABLE public.nest_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_suggestions FROM anon, authenticated;
