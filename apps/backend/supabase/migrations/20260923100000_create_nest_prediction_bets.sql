-- Practice bets on real prediction markets (2026-09-23).
--
-- The market data is real (live Kalshi questions and odds, via the prediction-market providers in
-- src/modules/nest/), but the bet itself is simulated: no money moves, nothing is placed on any
-- exchange, and this table is the only record. It deliberately does NOT touch nest_holdings — a
-- stake is not a position, and mixing it into the investing ledger would corrupt NAV and feed the
-- equal-weight allocator cash that isn't really there.
--
-- Everything needed to settle later is snapshotted at bet time, because the market's live odds
-- move afterwards and a payout has to honour the price the user actually took:
--   price          — the cost of their chosen side, 0-1, at the moment they bet
--   payout_usd     — stake / price, the binary-contract payout if their side wins
--   closes_at      — the real market's close, so we know when this is due to resolve
-- `question` is stored rather than joined so an old bet still reads correctly once the upstream
-- market is settled and gone.

CREATE TABLE IF NOT EXISTS nest_prediction_bets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL, -- ledger user id (real Privy DID or devnet-demo suffixed, see nest-ledger-id.ts)
  -- Venue-qualified market id, e.g. "kalshi:KXMETA-26OCTHEAD-69000".
  market_id    TEXT NOT NULL,
  venue        TEXT NOT NULL,
  symbol       TEXT, -- the xStock holding this market relates to, when it came from one
  question     TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  stake_usd    NUMERIC(12, 2) NOT NULL CHECK (stake_usd > 0),
  price        NUMERIC(6, 4) NOT NULL CHECK (price > 0 AND price < 1),
  payout_usd   NUMERIC(12, 2) NOT NULL CHECK (payout_usd > 0),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'void')),
  closes_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);

-- One open position per side of a market per user: betting Yes twice should raise the stake on
-- the existing position rather than creating a second row to reconcile at settlement.
CREATE UNIQUE INDEX IF NOT EXISTS nest_prediction_bets_open_idx
  ON nest_prediction_bets(user_id, market_id, side) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS nest_prediction_bets_user_status_idx ON nest_prediction_bets(user_id, status);
-- Settlement sweeps "active and past close", so index the pair.
CREATE INDEX IF NOT EXISTS nest_prediction_bets_due_idx ON nest_prediction_bets(status, closes_at);

-- Security: all access goes through service-role API routes
ALTER TABLE public.nest_prediction_bets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_prediction_bets FROM anon, authenticated;
