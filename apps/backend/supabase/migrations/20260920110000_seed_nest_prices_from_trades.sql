-- Seed nest_prices from the most recent fill per symbol: every nest_trades row was priced off a
-- real quote at fill time, so this gives a sensible last-known price immediately. Without it the
-- table stays empty — and weekend/after-hours valuations fall back to cost basis — until the
-- next trading-hours price fetch. Kept separate from 20260920100000_create_nest_prices.sql so
-- the create migration is never edited after being applied.
INSERT INTO nest_prices (symbol, price_usd, quoted_at)
SELECT DISTINCT ON (symbol) symbol, price_usd, created_at
FROM nest_trades
WHERE price_usd > 0
ORDER BY symbol, created_at DESC
ON CONFLICT (symbol) DO NOTHING;
