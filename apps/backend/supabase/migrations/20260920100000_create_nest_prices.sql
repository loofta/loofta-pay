-- Last-known-good quote per Nest symbol. Backed's issuer price endpoint returns {"quote":null}
-- outside trading hours (verified: every symbol, Saturday 2026-09-20), and the in-memory price
-- cache in xstocks.service.ts dies with the process — so a weekend dashboard load, or the first
-- load after a deploy, had no price at all for any position. This persists the most recent real
-- quote so those loads value holdings at the last close instead of at $0 or at cost.

CREATE TABLE IF NOT EXISTS nest_prices (
  symbol     TEXT PRIMARY KEY,
  price_usd  NUMERIC(18, 6) NOT NULL,
  quoted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security: all access goes through service-role API routes
ALTER TABLE public.nest_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_prices FROM anon, authenticated;
