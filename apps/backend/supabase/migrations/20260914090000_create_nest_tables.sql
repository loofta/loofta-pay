-- "Our Nest": auto-invest/robo-portfolio feature. Treasury holds pooled xStocks positions;
-- these tables are the per-user ledger + trade history + shared sentiment cache the
-- rebalance engine reads/writes. See nest.service.ts / nest-rebalance.service.ts.

CREATE TABLE IF NOT EXISTS nest_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  display_name   TEXT,
  risk_tolerance TEXT NOT NULL DEFAULT 'balanced' CHECK (risk_tolerance IN (
                    'conservative', 'balanced', 'aggressive'
                  )),
  interest_tags  TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nest_profiles_user_id_idx ON nest_profiles(user_id);

CREATE TABLE IF NOT EXISTS nest_holdings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  units        NUMERIC(28, 12) NOT NULL DEFAULT 0,
  avg_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nest_holdings_user_id_symbol_idx ON nest_holdings(user_id, symbol);

CREATE TABLE IF NOT EXISTS nest_trades (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  units        NUMERIC(28, 12) NOT NULL,
  price_usd    NUMERIC(18, 6) NOT NULL,
  usd_value    NUMERIC(18, 6) NOT NULL,
  reason       TEXT,
  tx_signature TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nest_trades_user_id_created_at_idx ON nest_trades(user_id, created_at);

-- Shared cache of the elfa.ai signal per symbol, refreshed on a schedule and read by every
-- user's rebalance calc — not per-user, so it's an upsert-per-refresh cache, not a log.
CREATE TABLE IF NOT EXISTS nest_sentiment_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        TEXT NOT NULL,
  score         NUMERIC(10, 6) NOT NULL,
  raw_mentions  INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nest_sentiment_scores_symbol_idx ON nest_sentiment_scores(symbol);

-- One row per user per day: total portfolio value + cost basis at the time the daily rebalance
-- cron ran. This is what the "performance over time" graph on the Nest page reads — reconstructing
-- historical NAV from nest_trades + point-in-time prices would require storing full daily price
-- history anyway, so a direct snapshot is simpler and is what a real robo-advisor would show.
CREATE TABLE IF NOT EXISTS nest_nav_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  total_value_usd NUMERIC(18, 6) NOT NULL,
  total_cost_usd  NUMERIC(18, 6) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nest_nav_snapshots_user_id_date_idx ON nest_nav_snapshots(user_id, snapshot_date);

-- Records each verified on-chain deposit into the Nest treasury. tx_hash is UNIQUE so the same
-- confirmed transfer can never be replayed into a second credit (same replay-protection shape as
-- pack_openings.payment_tx_hash for Mystery Pack payments).
CREATE TABLE IF NOT EXISTS nest_deposits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  amount_usdc NUMERIC(18, 6) NOT NULL,
  tx_hash     TEXT NOT NULL,
  -- 'devnet' rows are fee-free demo deposits (devnet USDC, no real value) — same ledger as real
  -- mainnet deposits for now because NEST_LIVE_TRADING is off and nothing is executed for real
  -- yet. MUST be excluded from any real-capital accounting (the rebalance engine's solvency
  -- check already filters on this) before live trading is ever turned on.
  network     TEXT NOT NULL DEFAULT 'mainnet' CHECK (network IN ('mainnet', 'devnet')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS nest_deposits_tx_hash_idx ON nest_deposits(tx_hash);
CREATE INDEX IF NOT EXISTS nest_deposits_user_id_idx ON nest_deposits(user_id);

-- Security: all access goes through service-role API routes
ALTER TABLE public.nest_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_profiles FROM anon, authenticated;

ALTER TABLE public.nest_holdings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_holdings FROM anon, authenticated;

ALTER TABLE public.nest_trades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_trades FROM anon, authenticated;

ALTER TABLE public.nest_sentiment_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_sentiment_scores FROM anon, authenticated;

ALTER TABLE public.nest_nav_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_nav_snapshots FROM anon, authenticated;

ALTER TABLE public.nest_deposits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_deposits FROM anon, authenticated;
