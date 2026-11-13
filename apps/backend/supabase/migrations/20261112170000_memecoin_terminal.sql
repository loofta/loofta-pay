-- Memecoin terminal: every coin that graduated from Pump.fun, with the market + risk numbers the
-- feed filters on. Written only by the backend (service role). RLS is on and anon/authenticated
-- are revoked so the table is never readable straight from the browser; the app reads it through
-- the backend /memecoin endpoints.
--
-- Phase 1 stores migrated coins only. Launches that never migrate are just counted (see
-- memecoin_launch_stats) so the UI can say how many junk launches were hidden.

CREATE TABLE IF NOT EXISTS public.memecoin_tokens (
  mint TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  status TEXT NOT NULL DEFAULT 'migrated' CHECK (status IN ('launchpad', 'migrated')),
  migrated_at TIMESTAMPTZ,
  curve_progress NUMERIC,            -- 0..1, only meaningful while status = 'launchpad'

  name TEXT,
  symbol TEXT,
  image_url TEXT,
  website TEXT,
  twitter TEXT,
  telegram TEXT,
  socials JSONB,

  -- market data (DexScreener)
  pair_address TEXT,
  dex_id TEXT,
  mcap_usd NUMERIC,
  liquidity_usd NUMERIC,
  volume_24h_usd NUMERIC,
  price_change_1h NUMERIC,
  price_change_24h NUMERIC,
  dex_paid BOOLEAN NOT NULL DEFAULT FALSE,

  -- holder / risk data (Solana Tracker). NULL means "provider has not told us", which the
  -- filters treat as NOT passing: unknown is never assumed safe.
  holders INTEGER,
  bundler_pct NUMERIC,
  dev_pct NUMERIC,
  sniper_pct NUMERIC,
  top10_pct NUMERIC,
  lp_burn_pct NUMERIC,
  mint_authority_active BOOLEAN,
  freeze_authority_active BOOLEAN,
  rugged BOOLEAN,
  risk_score NUMERIC,

  metrics_updated_at TIMESTAMPTZ,
  enrich_failures INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memecoin_tokens_migrated_at ON public.memecoin_tokens(migrated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memecoin_tokens_metrics_updated ON public.memecoin_tokens(metrics_updated_at NULLS FIRST);

ALTER TABLE public.memecoin_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.memecoin_tokens FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_memecoin_tokens_updated_at ON public.memecoin_tokens;
CREATE TRIGGER trg_memecoin_tokens_updated_at
  BEFORE UPDATE ON public.memecoin_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Hourly count of every Pump.fun launch we saw, for "N junk launches hidden today".
CREATE TABLE IF NOT EXISTS public.memecoin_launch_stats (
  hour TIMESTAMPTZ PRIMARY KEY,
  launches INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.memecoin_launch_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.memecoin_launch_stats FROM anon, authenticated;

-- Atomic "add n to this hour" so several backend instances can flush without losing counts.
CREATE OR REPLACE FUNCTION public.memecoin_add_launches(p_hour TIMESTAMPTZ, p_n INTEGER)
RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
AS $$
  INSERT INTO public.memecoin_launch_stats (hour, launches)
  VALUES (p_hour, p_n)
  ON CONFLICT (hour) DO UPDATE SET launches = public.memecoin_launch_stats.launches + EXCLUDED.launches;
$$;

REVOKE ALL ON FUNCTION public.memecoin_add_launches(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
