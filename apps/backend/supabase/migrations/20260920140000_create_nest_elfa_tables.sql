-- Elfa usage rework: the daily refresh was 2 API calls per symbol per day for the whole
-- universe (~180/day) and re-ran on every deposit, which burned a 1,000-call month in a week.
-- These tables let us (1) fetch each symbol's mention count ONCE per day and derive the 6-day
-- baseline from stored history instead of refetching it, (2) cache the "post behind this trade"
-- lookup for 24h instead of hitting Elfa on every dashboard load, and (3) meter our own calls so
-- the engine degrades to yesterday's scores near the budget instead of dying mid-month.

CREATE TABLE IF NOT EXISTS nest_mention_counts (
  symbol          TEXT NOT NULL,
  day             DATE NOT NULL,
  count           INTEGER NOT NULL,
  -- Prior-6-day window total, fetched only on a symbol's first day(s) while stored daily
  -- history is too thin to average; NULL once real history exists.
  baseline_total  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, day)
);

CREATE TABLE IF NOT EXISTS nest_elfa_posts (
  symbol        TEXT PRIMARY KEY,
  link          TEXT NOT NULL,
  username      TEXT NOT NULL,
  like_count    INTEGER NOT NULL DEFAULT 0,
  mentioned_at  TIMESTAMPTZ,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nest_elfa_usage (
  month       TEXT PRIMARY KEY, -- 'YYYY-MM' (UTC)
  calls       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security: all access goes through service-role API routes
ALTER TABLE public.nest_mention_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_mention_counts FROM anon, authenticated;
ALTER TABLE public.nest_elfa_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_elfa_posts FROM anon, authenticated;
ALTER TABLE public.nest_elfa_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nest_elfa_usage FROM anon, authenticated;
