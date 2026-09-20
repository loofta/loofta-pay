-- Repair: xstocks.service.ts briefly persisted a "price" of 0 for every symbol whose Backed
-- quote was null (Number(null) === 0 slipped past the isFinite check — fixed in code, now
-- rejects <= 0). Those zero rows then blocked the seed migration's ON CONFLICT DO NOTHING.
-- Purge them and re-seed from the most recent real fill per symbol. Idempotent.
DELETE FROM nest_prices WHERE price_usd <= 0;

INSERT INTO nest_prices (symbol, price_usd, quoted_at)
SELECT DISTINCT ON (symbol) symbol, price_usd, created_at
FROM nest_trades
WHERE price_usd > 0
ORDER BY symbol, created_at DESC
ON CONFLICT (symbol) DO NOTHING;
