-- Weekly quest: move TARGET USD (sends + withdrawals + cash outs) in a calendar week (Mon 00:00 UTC)
-- and earn one free, treasury-funded Megapot entry, awarded automatically by the weekly-quest cron.

-- Single-row settings. Awarding is OFF until an admin turns it on in the admin Weekly Quest tab.
CREATE TABLE IF NOT EXISTS weekly_quest_settings (
  id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  target_usd         NUMERIC NOT NULL DEFAULT 150 CHECK (target_usd > 0),
  tickets_per_winner INT NOT NULL DEFAULT 1 CHECK (tickets_per_winner BETWEEN 1 AND 10),
  -- Hard cap on treasury spend per week for this quest (1 ticket = $1). Never shown to users.
  weekly_budget_usd  NUMERIC NOT NULL DEFAULT 10 CHECK (weekly_budget_usd >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO weekly_quest_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One row per qualifying user per week. The UNIQUE key is the idempotency guard: a row is inserted
-- (status 'awarding') BEFORE any treasury money moves, so a retry or overlapping run can never buy twice.
CREATE TABLE IF NOT EXISTS weekly_quest_awards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  week_start       DATE NOT NULL,
  volume_usd       NUMERIC NOT NULL,
  tickets          INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'awarding' CHECK (status IN ('awarding', 'awarded', 'failed', 'skipped_budget', 'disabled')),
  lottery_ticket_id UUID,
  failure_reason   TEXT,
  qualified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  awarded_at       TIMESTAMPTZ,
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS weekly_quest_awards_week_idx ON weekly_quest_awards(week_start, status);

-- Security: all access goes through service-role API routes
ALTER TABLE public.weekly_quest_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_quest_settings FROM anon, authenticated;
ALTER TABLE public.weekly_quest_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_quest_awards FROM anon, authenticated;
